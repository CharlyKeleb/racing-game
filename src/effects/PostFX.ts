import { ScaledBloomEffect } from './ScaledBloomEffect'
import { HAZE_STRENGTH } from './HeatHaze'
import type { QualityPreset } from '../stores/gameStore'
import * as THREE from 'three'
import {
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing'

/** Horizontal smear for the intro's whip-pans. `strength` is the smear width in UV units. */
class WhipBlurEffect extends Effect {
  constructor() {
    super(
      'WhipBlurEffect',
      /* glsl */ `
        uniform float strength;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec4 sum = vec4(0.0);
          for (int i = 0; i < 12; i++) {
            float t = float(i) / 11.0 - 0.5;
            sum += texture2D(inputBuffer, uv + vec2(t * strength, 0.0));
          }
          outputColor = sum / 12.0;
        }
      `,
      { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([['strength', new THREE.Uniform(0)]]) },
    )
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

/** The heat-haze source: a scene of distortion puffs, and whether anything is in it this frame. */
export interface HazeSource {
  readonly scene: THREE.Scene
  readonly active: boolean
}

/** Bloom + preset-scaled AA (SMAA on High, FXAA otherwise) + ACES, with optional intro whip blur. */
export class PostFX {
  private readonly bloom = new ScaledBloomEffect({ intensity: 0.35, luminanceThreshold: 1.2, luminanceSmoothing: 0.2, mipmapBlur: true })
  private readonly composer: EffectComposer
  private readonly whip = new WhipBlurEffect()
  private readonly mainPass: EffectPass
  private readonly whipPass: EffectPass
  private readonly renderer: THREE.WebGLRenderer
  private readonly camera: THREE.Camera
  /** Half-resolution signed offsets drawn by the haze puffs. */
  private readonly hazeTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false })
  private readonly hazePass: EffectPass
  private haze: HazeSource | null = null
  private readonly clearColor = new THREE.Color()

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: QualityPreset) {
    this.renderer = renderer
    this.camera = camera
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(scene, camera))
    // Haze first, so bloom and AA see the shimmered image. Off unless a puff is up.
    this.hazePass = new EffectPass(camera, new HeatHazeEffect(this.hazeTarget.texture))
    this.hazePass.enabled = false
    this.composer.addPass(this.hazePass)
    this.mainPass = new EffectPass(
      camera,
      this.bloom,
      quality === 'high' ? new SMAAEffect() : new FXAAEffect(),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
    )
    this.bloom.renderScale = quality === 'high' ? 1 : quality === 'medium' ? .5 : .25
    this.bloom.mipmapBlurPass.levels = quality === 'high' ? 8 : quality === 'medium' ? 5 : 3
    this.composer.addPass(this.mainPass)
    this.whipPass = new EffectPass(camera, this.whip)
    this.composer.addPass(this.whipPass)
    // Only the last enabled pass may draw to the screen, so the two hand it back and forth.
    this.whipPass.enabled = false
    this.mainPass.renderToScreen = true
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    this.hazeTarget.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1))
  }

  /** Whip-pan smear width in UV units; 0 skips the pass entirely. */
  setWhipBlur(strength: number): void {
    this.whip.uniforms.get('strength')!.value = strength
    const on = strength > 0.001
    if (on === this.whipPass.enabled) return
    this.whipPass.enabled = this.whipPass.renderToScreen = on
    this.mainPass.renderToScreen = !on
  }

  setHaze(haze: HazeSource | null): void {
    this.haze = haze
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h)
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.hazeTarget.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1))
  }

  render(): void {
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
    this.hazeTarget.dispose()
    this.composer.dispose()
  }
}
