import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { PostFX } from '../effects/PostFX'
import type { QualityPreset } from '../stores/gameStore'

/** Owns the WebGL context, scene, camera, environment map and post stack. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000)
  private postfx: PostFX
  private postfxEnabled = true
  private readonly resizeObserver: ResizeObserver
  private readonly container: HTMLElement
  // Dynamic resolution: pixel ratio floats between min and max to hold ~60 fps.
  private maxRatio = 1
  private minRatio = 0.6
  private ratio = 1
  private windowTime = 0
  private windowFrames = 0
  private goodWindows = 0

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    // Tone mapping is applied by the post stack; see PostFX.
    this.renderer.toneMapping = THREE.NoToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(this.renderer.domElement)

    // Image-based lighting so PBR car paint has something to reflect.
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.6
    pmrem.dispose()

    this.postfx = new PostFX(this.renderer, this.scene, this.camera)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  applyQuality(quality: QualityPreset, postfx: boolean): void {
    const dpr = window.devicePixelRatio
    // Phones have DPR 3 — rendering at that is 9× the pixels for little gain.
    this.maxRatio = quality === 'low' ? Math.min(dpr, 1) : quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2)
    this.minRatio = quality === 'low' ? 0.55 : 0.75
    this.ratio = this.maxRatio
    this.goodWindows = 0
    this.renderer.setPixelRatio(this.ratio)
    this.renderer.shadowMap.enabled = quality !== 'low'
    this.renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap
    this.postfxEnabled = postfx
    this.renderer.toneMapping = postfx ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
    this.resize()
  }

  /** Distance beyond which nothing is drawn; tracks set it from their fog. */
  setViewDistance(far: number): void {
    this.camera.far = far
    this.camera.updateProjectionMatrix()
  }

  /**
   * Dynamic resolution. Every second, drop the pixel ratio when we're under
   * ~55 fps, and creep back up after a few smooth seconds. Fill rate is the
   * usual mobile bottleneck, so this is the cheapest way to keep 60 fps.
   */
  adapt(dt: number): void {
    if (dt > 0.2) return // tab switch / stall, not a real frame
    this.windowTime += dt
    this.windowFrames++
    if (this.windowTime < 1) return
    const fps = this.windowFrames / this.windowTime
    this.windowTime = 0
    this.windowFrames = 0
    let next = this.ratio
    if (fps < 55) {
      next = Math.max(this.minRatio, this.ratio - (fps < 40 ? 0.2 : 0.1))
      this.goodWindows = 0
    } else if (fps > 58 && ++this.goodWindows >= 3) {
      next = Math.min(this.maxRatio, this.ratio + 0.05)
      this.goodWindows = 0
    }
    if (Math.abs(next - this.ratio) > 0.001) {
      this.ratio = next
      this.renderer.setPixelRatio(next)
      this.resize()
    }
  }

  get pixelRatio(): number {
    return this.ratio
  }

  render(): void {
    if (this.postfxEnabled) this.postfx.render()
    else this.renderer.render(this.scene, this.camera)
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.postfx.setSize(w, h)
  }

  dispose(): void {
    this.resizeObserver.disconnect()
    this.postfx.dispose()
    this.scene.environment?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
