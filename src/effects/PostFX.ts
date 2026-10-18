import * as THREE from 'three'
import {
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
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

/** Bloom (headlights, sun glints) + SMAA + ACES tone mapping, plus a whip blur that only runs while it's needed. */
export class PostFX {
  private readonly composer: EffectComposer
  private readonly whip = new WhipBlurEffect()
  private readonly mainPass: EffectPass
  private readonly whipPass: EffectPass

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(scene, camera))
    this.mainPass = new EffectPass(
      camera,
      new BloomEffect({ intensity: 0.35, luminanceThreshold: 1.2, luminanceSmoothing: 0.2, mipmapBlur: true }),
      new SMAAEffect(),
      new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
    )
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
