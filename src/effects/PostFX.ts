import { MotionVectors } from './MotionVectors'
import { MotionBlurEffect } from './MotionBlur'
import { BOOST_BLUR_CENTER, BOOST_BLUR_INNER, BOOST_BLUR_OUTER, BOOST_BLUR_SPREAD, boostBlurSamples } from './BoostBlur'
import { ScaledBloomEffect } from './ScaledBloomEffect'
import { HAZE_STRENGTH } from './HeatHaze'
import { MAX_SCENE_RADIANCE, VIGNETTE_DARKNESS, VIGNETTE_OFFSET } from './grade'
import type { QualityPreset } from '../stores/gameStore'
import * as THREE from 'three'
import {
  BlendFunction,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing'

/**
 * Drops NaN/Inf pixels and clamps extreme radiance before any blur reads the scene.
 * Bloom's mip pyramid spreads one bad pixel into growing black squares (seen on Safari).
 * Metal and ANGLE's D3D backend compile with fast math, which folds isnan()/isinf() and
 * x == x to false, so the test reads the exponent bits instead (all ones = NaN or Inf).
 */
class SanitizeEffect extends Effect {
  constructor() {
    super('SanitizeEffect', /* glsl */ `
      bool nonFinite(float v) { return (floatBitsToUint(v) & 0x7f800000u) == 0x7f800000u; }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        bool bad = nonFinite(c.r) || nonFinite(c.g) || nonFinite(c.b);
        outputColor = vec4(bad ? vec3(0.) : clamp(c, 0., ${MAX_SCENE_RADIANCE.toFixed(1)}), nonFinite(inputColor.a) ? 1. : inputColor.a);
      }
    `, { blendFunction: BlendFunction.SRC })
    // SRC, not the default NORMAL: NORMAL mixes the result with the input, and mix(NaN, c, 1.) is
    // still NaN, so the bad pixel went straight on to bloom. That is why the first version did nothing.
  }
}

/** Offsets the image by the heat-haze buffer's signed rg (#56). */
class HeatHazeEffect extends Effect {
  constructor(distortion: THREE.Texture) {
    super(
      'HeatHazeEffect',
      /* glsl */ `
        uniform sampler2D distortion;
        uniform float strength;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec2 offset = texture2D(distortion, uv).rg * strength;
          outputColor = texture2D(inputBuffer, uv + offset);
        }
      `,
      {
        attributes: EffectAttribute.CONVOLUTION,
        uniforms: new Map<string, THREE.Uniform>([['distortion', new THREE.Uniform(distortion)], ['strength', new THREE.Uniform(HAZE_STRENGTH)]]),
      },
    )
  }
}

/** Nitro zoom blur toward BOOST_BLUR_CENTER (effects/BoostBlur.ts). */
class BoostBlurEffect extends Effect {
  constructor(samples: number) {
    super('NitroBoostBlur', /* glsl */ `
      uniform float strength;
      uniform vec2 center;
      uniform float aspect;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 toCenter = center - uv;
        float d = length(toCenter * vec2(aspect, 1.)) * 2.;
        float amount = strength * smoothstep(${BOOST_BLUR_INNER.toFixed(3)}, ${BOOST_BLUR_OUTER.toFixed(3)}, d);
        if (amount <= .001) { outputColor = inputColor; return; }
        vec2 stepUv = toCenter * (${BOOST_BLUR_SPREAD.toFixed(3)} * amount / float(${samples - 1}));
        vec4 sum = inputColor;
        for (int i = 1; i < ${samples}; i++) sum += texture2D(inputBuffer, uv + stepUv * float(i));
        outputColor = sum / float(${samples});
      }
    `, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['strength', new THREE.Uniform(0)],
        ['center', new THREE.Uniform(BOOST_BLUR_CENTER.clone())],
        ['aspect', new THREE.Uniform(1)],
      ]),
    })
  }

  set strength(value: number) { this.uniforms.get('strength')!.value = value }

  override setSize(width: number, height: number): void {
    this.uniforms.get('aspect')!.value = width / Math.max(1, height)
  }
}

/** The heat-haze source: a scene of distortion puffs, and whether anything is in it this frame. */
export interface HazeSource {
  readonly scene: THREE.Scene
  readonly active: boolean
}

/** Bloom + preset-scaled AA (SMAA from Medium, FXAA on Low) + ACES + vignette, with speed-scaled velocity blur. */
export class PostFX {
  private readonly vectors = new MotionVectors()
  private readonly motion: MotionBlurEffect
  private readonly motionPass: EffectPass
  private readonly scene: THREE.Scene
  private exposure = 0
  private player: THREE.Object3D | null = null
  private readonly bloom = new ScaledBloomEffect({ intensity: 0.35, luminanceThreshold: 1.2, luminanceSmoothing: 0.2, mipmapBlur: true })
  private readonly composer: EffectComposer
  private readonly mainPass: EffectPass
  private readonly renderer: THREE.WebGLRenderer
  private readonly camera: THREE.Camera
  /** Half-resolution signed offsets drawn by the haze puffs. */
  private readonly hazeTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false })
  private readonly hazePass: EffectPass
  private haze: HazeSource | null = null
  /** Nitro zoom blur (BoostBlur.ts); its pass is off while there's no boost. */
  private readonly boost: BoostBlurEffect
  private readonly boostPass: EffectPass
  private readonly clearColor = new THREE.Color()

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: QualityPreset) {
    this.scene = scene
    this.renderer = renderer
    this.camera = camera
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(new EffectPass(camera, new SanitizeEffect()))
    this.motion = new MotionBlurEffect(this.vectors.target.texture, quality === 'high' ? 12 : quality === 'medium' ? 8 : 6)
    this.motionPass = new EffectPass(camera, this.motion)
    this.motionPass.enabled = false
    this.composer.addPass(this.motionPass)
    // Haze before bloom and AA, so they see the shimmered image. Off unless a puff is up.
    this.hazePass = new EffectPass(camera, new HeatHazeEffect(this.hazeTarget.texture))
    this.hazePass.enabled = false
    this.composer.addPass(this.hazePass)
    // After motion blur and haze, before bloom: the trails' glow smears with the scene.
    this.boost = new BoostBlurEffect(boostBlurSamples(quality))
    this.boostPass = new EffectPass(camera, this.boost)
    this.boostPass.enabled = false
    this.composer.addPass(this.boostPass)
    this.mainPass = new EffectPass(
      camera,
      this.bloom,
      // SMAA from Medium up: FXAA's blur softened the car's edges and badges.
      quality === 'low' ? new FXAAEffect() : new SMAAEffect(),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      new VignetteEffect({ offset: VIGNETTE_OFFSET, darkness: VIGNETTE_DARKNESS }),
    )
    this.bloom.renderScale = quality === 'high' ? 1 : quality === 'medium' ? .5 : .25
    this.bloom.mipmapBlurPass.levels = quality === 'high' ? 8 : quality === 'medium' ? 5 : 3
    this.composer.addPass(this.mainPass)
    this.mainPass.renderToScreen = true
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.hazeTarget.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1))
    this.vectors.setSize(size.x, size.y)
  }

  setMotionBlur(exposure: number, player: THREE.Object3D | null): void {
    this.exposure = exposure
    this.player = player
    if (exposure <= 0) this.vectors.reset()
  }

  setHaze(haze: HazeSource | null): void {
    this.haze = haze
  }

  setBoostBlur(strength: number): void {
    this.boost.strength = strength
    this.boostPass.enabled = strength > 0.001
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h)
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.hazeTarget.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1))
    this.vectors.setSize(size.x, size.y)
  }

  render(): void {
    this.motionPass.enabled = this.exposure > 0 && this.vectors.capture(this.renderer, this.scene, this.camera, this.player)
    this.motion.uniforms.get('exposure')!.value = this.exposure
    const haze = this.haze?.active ? this.haze : null
    this.hazePass.enabled = !!haze
    if (haze) {
      const renderer = this.renderer
      const alpha = renderer.getClearAlpha()
      renderer.getClearColor(this.clearColor)
      renderer.setRenderTarget(this.hazeTarget)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, false, false)
      renderer.render(haze.scene, this.camera)
      renderer.setRenderTarget(null)
      renderer.setClearColor(this.clearColor, alpha)
    }
    this.composer.render()
  }

  dispose(): void {
    this.vectors.dispose()
    this.hazeTarget.dispose()
    this.composer.dispose()
  }
}
