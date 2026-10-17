import * as THREE from 'three'
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing'

/** Bloom (headlights, sun glints) + SMAA + ACES tone mapping. */
export class PostFX {
  private readonly composer: EffectComposer

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType })
    this.composer.addPass(new RenderPass(scene, camera))
    this.composer.addPass(
      new EffectPass(
        camera,
        new BloomEffect({ intensity: 0.35, luminanceThreshold: 1.2, luminanceSmoothing: 0.2, mipmapBlur: true }),
        new SMAAEffect(),
        new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }),
      ),
    )
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
