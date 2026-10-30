import * as THREE from 'three/webgpu'
import { MotionVectors } from '../../effects/MotionVectors'
import { Fn, Loop, convertToTexture, float, pass, renderOutput, screenUV, uniform, uv, texture, length, min, max, abs, step, smoothstep, vec2, vec3, vec4, distance, If, select, floatBitsToUint, bitAnd, uint } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { smaa } from 'three/addons/tsl/display/SMAANode.js'
import type { QualityPreset } from '../../stores/gameStore'
import { HAZE_STRENGTH } from '../../effects/HeatHaze'
import { BOOST_BLUR_CENTER, BOOST_BLUR_INNER, BOOST_BLUR_OUTER, BOOST_BLUR_SPREAD, boostBlurSamples } from '../../effects/BoostBlur'
import type { HazeSource } from '../../effects/PostFX'
import { MAX_SCENE_RADIANCE, VIGNETTE_DARKNESS, VIGNETTE_OFFSET } from '../../effects/grade'

/**
 * The post stack for WebGPURenderer, as TSL nodes: the same chain as the
 * `postprocessing` one in effects/PostFX.ts (WebGL only). Bloom over a
 * half-float scene pass, then ACES + sRGB, then SMAA on High or FXAA, and
 * depth-aware velocity blur before bloom and grading, then the nitro zoom blur.
 */
export class NodePostFX {
  private readonly vectors = new MotionVectors()
  private readonly exposure = uniform(0)
  /** Nitro zoom blur strength (effects/BoostBlur.ts); 0 skips the samples. */
  private readonly boost = uniform(0)
  private amount = 0
  private player: THREE.Object3D | null = null
  private readonly renderer: THREE.WebGPURenderer
  private readonly pipeline: THREE.RenderPipeline
  private readonly scene: THREE.Scene
  private readonly camera: THREE.Camera
  private readonly quality: QualityPreset

  constructor(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, quality: QualityPreset) {
    this.renderer = renderer
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
    const beauty = scenePass.getTextureNode('output')
    const vectors = texture(this.vectors.target.texture)
    const exposure = this.exposure
    const blurred = Fn(() => {
      const at = uv()
      const output = beauty.sample(at).toVar()
      If(exposure.greaterThan(0), () => {
        const center = vectors.sample(at)
        const motion = center.rg.mul(exposure).mul(center.b.oneMinus()).toVar()
        const pixels = length(motion.mul(uniform(this.size)))
        motion.mulAssign(min(1, float(24).div(max(pixels, .001))))
        const sum = beauty.sample(at).toVar()
        const weight = float(1).toVar()
        const samples = quality === 'high' ? 12 : quality === 'medium' ? 8 : 6
        Loop({ start: 1, end: samples, type: 'int', condition: '<' }, ({ i }) => {
          const t = float(i).div(samples - 1).sub(.5)
          const sampleUV = at.add(motion.mul(t)).clamp(0, 1)
          const sample = vectors.sample(sampleUV)
          const accept = step(.5, sample.b).oneMinus().mul(step(abs(center.a.sub(sample.a)), max(.0005, center.a.mul(.03))))
          sum.addAssign(beauty.sample(sampleUV).mul(accept))
          weight.addAssign(accept)
        })
        output.assign(sum.div(weight))
      })
      return output
    })()
    let color: THREE.Node<'vec4'> = blurred
    if (haze) {
      const hazePass = pass(haze.scene, camera)
      hazePass.setResolutionScale(0.5)
      const offset = hazePass.getTextureNode('output').sample(screenUV).rg.mul(HAZE_STRENGTH)
      color = convertToTexture(blurred).sample(screenUV.add(offset))
    }
    // Nitro zoom blur, after motion blur and haze, before bloom: same maths as BoostBlurEffect (WebGL).
    const boost = this.boost
    const boostSamples = boostBlurSamples(quality)
    const boostSource = convertToTexture(color)
    const aspect = this.aspect
    color = Fn(() => {
      const at = screenUV
      const output = boostSource.sample(at).toVar()
      If(boost.greaterThan(0.001), () => {
        const toCenter = vec2(BOOST_BLUR_CENTER.x, 1 - BOOST_BLUR_CENTER.y).sub(at).toVar()
        const d = length(toCenter.mul(vec2(aspect, 1))).mul(2)
        const amount = boost.mul(smoothstep(BOOST_BLUR_INNER, BOOST_BLUR_OUTER, d))
        const stepUv = toCenter.mul(amount.mul(BOOST_BLUR_SPREAD / (boostSamples - 1))).toVar()
        const sum = output.toVar()
        Loop({ start: 1, end: boostSamples, type: 'int', condition: '<' }, ({ i }) => {
          sum.addAssign(boostSource.sample(at.add(stepUv.mul(float(i)))))
        })
        output.assign(sum.div(boostSamples))
      })
      return output
    })()
    // SanitizeEffect twin: bloom's mip chain spreads a NaN/Inf pixel into black squares. Fast-math
    // shader compilers fold NaN comparisons away, so test the exponent bits (all ones = NaN or Inf).
    const exponent = uint(0x7f800000)
    const nonFinite = (v: Parameters<typeof floatBitsToUint>[0]) => bitAnd(floatBitsToUint(v) as unknown as typeof exponent, exponent).equal(exponent) // BitcastNode is untyped
    const raw = color
    const bad = nonFinite(raw.r).or(nonFinite(raw.g)).or(nonFinite(raw.b))
    color = vec4(select(bad, vec3(0), max(min(raw.rgb, MAX_SCENE_RADIANCE), 0)), raw.a)
    const glow = bloom(color, 0.35, 0.5, 1.2)
    glow.smoothWidth.value = 0.2
    glow.setResolutionScale(quality === 'high' ? 0.5 : quality === 'medium' ? 0.35 : 0.25)
    const toned = renderOutput(color.add(glow))
    // VignetteEffect's default technique (WebGL stack), written with the edges in rising order.
    const fade = smoothstep(VIGNETTE_OFFSET * 0.799, 0.8, distance(screenUV, vec2(0.5)).mul(VIGNETTE_DARKNESS + VIGNETTE_OFFSET)).oneMinus()
    const graded = vec4(toned.rgb.mul(fade), toned.a)
    // SMAA from Medium up: FXAA's blur softened the car's edges and badges.
    this.pipeline.outputNode = quality === 'low' ? fxaa(graded) : smaa(graded)
    this.pipeline.needsUpdate = true
  }

  private readonly size = new THREE.Vector2(1, 1)
  private readonly aspect = uniform(1)

  setBoostBlur(strength: number): void {
    this.boost.value = strength
  }

  setMotionBlur(exposure: number, player: THREE.Object3D | null): void {
    this.amount = exposure
    this.player = player
    if (exposure <= 0) this.vectors.reset()
  }

  /** Keep the velocity mask aligned with the beauty pass at the active render resolution. */
  setSize(): void {
    this.renderer.getDrawingBufferSize(this.size)
    this.vectors.setSize(this.size.x, this.size.y)
  }

  render(): void {
    this.renderer.getDrawingBufferSize(this.size)
    this.aspect.value = this.size.x / Math.max(1, this.size.y)
    if (this.vectors.target.width !== this.size.x || this.vectors.target.height !== this.size.y) this.vectors.setSize(this.size.x, this.size.y)
    this.exposure.value = this.amount > 0 && this.vectors.capture(this.renderer, this.scene, this.camera, this.player) ? this.amount : 0
    this.pipeline.render()
  }

  dispose(): void {
    this.vectors.dispose()
    this.pipeline.dispose()
  }
}
