import { ScaledBloomEffect } from './ScaledBloomEffect'
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

/** Bloom + preset-scaled AA (SMAA on High, FXAA otherwise) + ACES, with optional intro whip blur. */
export class PostFX {
  private readonly bloom = new ScaledBloomEffect({ intensity: 0.35, luminanceThreshold: 1.2, luminanceSmoothing: 0.2, mipmapBlur: true })
  private readonly composer: EffectComposer
  private readonly whip = new WhipBlurEffect()
  private readonly mainPass: EffectPass
  private readonly whipPass: EffectPass

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: QualityPreset) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(scene, camera))
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
  }

  /** Whip-pan smear width in UV units; 0 skips the pass entirely. */
  setWhipBlur(strength: number): void {
    this.whip.uniforms.get('strength')!.value = strength
    const on = strength > 0.001
    if (on === this.whipPass.enabled) return
    this.whipPass.enabled = this.whipPass.renderToScreen = on
    this.mainPass.renderToScreen = !on
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h)
  }

  render(): void {
    this.composer.render()
  }

  dispose(): void {
    this.composer.dispose()
  }
}
