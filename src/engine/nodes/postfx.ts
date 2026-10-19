import * as THREE from 'three/webgpu'
import { Fn, Loop, convertToTexture, float, pass, renderOutput, screenUV, uniform, uv, vec2, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import type { QualityPreset } from '../../stores/gameStore'
import { HAZE_STRENGTH } from '../../effects/HeatHaze'
import type { HazeSource } from '../../effects/PostFX'

/**
 * The post stack for WebGPURenderer, as TSL nodes: the same chain as the
 * `postprocessing` one in effects/PostFX.ts (WebGL only). Bloom over a
 * half-float scene pass, then ACES + sRGB, then SMAA on High or FXAA, and
 * the intro's whip-pan smear on top while it's active.
 */
export class NodePostFX {
  private readonly pipeline: THREE.RenderPipeline
  private readonly strength = uniform(0)
  private plain!: THREE.Node
  private whipped!: THREE.Node
  private whipOn = false
  private readonly scene: THREE.Scene
  private readonly camera: THREE.Camera
  private readonly quality: QualityPreset

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, quality: QualityPreset) {
    this.pipeline = new THREE.RenderPipeline(renderer)
    // Tone mapping and the sRGB transform happen in renderOutput, before AA (which wants display values).
    this.pipeline.outputColorTransform = false
    this.scene = scene
    this.camera = camera
    this.quality = quality
    this.build(null)
  }

  /**
   * Heat haze (#56): a half-resolution pass of the haze puffs gives signed
   * offsets the scene colour is sampled through, before bloom and AA. It
   * stays in the graph while a source is set (an empty pass is cheap;
   * rebuilding the graph whenever haze came and went would recompile).
   */
  setHaze(haze: HazeSource | null): void {
    this.build(haze)
  }

  private build(haze: HazeSource | null): void {
    const { scene, camera, quality } = this
    const scenePass = pass(scene, camera)
    let color: THREE.Node<'vec4'> = scenePass.getTextureNode('output')
    if (haze) {
      const hazePass = pass(haze.scene, camera)
      hazePass.setResolutionScale(0.5)
      const offset = hazePass.getTextureNode('output').sample(screenUV).rg.mul(HAZE_STRENGTH)
      color = scenePass.getTextureNode('output').sample(screenUV.add(offset))
    }
    const glow = bloom(color, 0.35, 0.5, 1.2)
    glow.smoothWidth.value = 0.2
    glow.setResolutionScale(quality === 'high' ? 0.5 : quality === 'medium' ? 0.35 : 0.25)
    const graded = renderOutput(color.add(glow))
    this.plain = quality === 'high' ? smaa(graded) : fxaa(graded)

    const shown = convertToTexture(this.plain)
    const strength = this.strength
    this.whipped = Fn(() => {
      const sum = vec4(0).toVar()
      Loop(12, ({ i }) => {
        const t = float(i).div(11).sub(0.5)
        sum.addAssign(shown.sample(uv().add(vec2(t.mul(strength), 0))))
      })
      return sum.div(12)
    })()
    this.pipeline.outputNode = this.whipOn ? this.whipped : this.plain
    this.pipeline.needsUpdate = true
  }

  /** Whip-pan smear width in UV units; 0 drops the extra pass. */
  setWhipBlur(strength: number): void {
    this.strength.value = strength
    const on = strength > 0.001
    if (on === this.whipOn) return
    this.whipOn = on
    this.pipeline.outputNode = on ? this.whipped : this.plain
    this.pipeline.needsUpdate = true
  }

  /** The pipeline sizes its targets from the renderer, so there's nothing to resize here. */
  setSize(): void {}

  render(): void {
    this.pipeline.render()
  }

  dispose(): void {
    this.pipeline.dispose()
  }
}
