import { AdaptiveResolution } from './AdaptiveResolution'
import { renderDiagnostics } from './renderDiagnostics'
import { GpuTimer } from './GpuTimer'
import { performanceCapture } from './PerformanceCapture'
import * as THREE from 'three'
import { PostFX } from '../effects/PostFX'
import type { QualityPreset } from '../stores/gameStore'

/** Owns the WebGL context, scene, camera and post stack. */
export class Renderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000)
  private gpuTimer?: GpuTimer
  private postfx?: PostFX
  private quality?: QualityPreset
  private displayDpr = 1
  private resolution = new AdaptiveResolution('high', 1)
  private readonly resizeObserver: ResizeObserver
  private readonly container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false })
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    // Tone mapping is applied by the post stack; see PostFX.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    container.appendChild(this.renderer.domElement)

    // Image-based lighting comes from world/Environment (sky-baked, per time of day).

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
  }

  applyQuality(quality: QualityPreset, postfx: boolean): void {
    const dpr = window.devicePixelRatio
    const qualityChanged = this.quality !== quality
    const resolutionChanged = qualityChanged || this.displayDpr !== dpr
    if (resolutionChanged) {
      this.quality = quality
      this.displayDpr = dpr
      this.resolution = new AdaptiveResolution(quality, dpr)
      this.renderer.setPixelRatio(this.pixelRatio)
    }
    this.renderer.shadowMap.enabled = quality !== 'low' && !renderDiagnostics.shadowsOff
    const enabled = postfx && !renderDiagnostics.postfxOff
    if (this.postfx && (!enabled || qualityChanged)) {
      this.postfx.dispose()
      this.postfx = undefined
    }
    if (enabled && !this.postfx) {
      this.postfx = new PostFX(this.renderer, this.scene, this.camera, renderDiagnostics.postfxQuality ?? quality)
      // The constructor sizes from the renderer's existing drawing buffer.
    }
    this.renderer.toneMapping = enabled ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
    this.renderer.autoClear = !enabled
    if (resolutionChanged) this.resize()
  }

  /** Distance beyond which nothing is drawn; tracks set it from their fog. */
  setViewDistance(far: number): void {
    this.camera.far = far
    this.camera.updateProjectionMatrix()
  }

  /** Ignore background frames; require sustained headroom and cooldowns to resize. */
  adapt(dt: number): void {
    if (document.hidden) { this.resolution.resetWindow(); return }
    if (renderDiagnostics.fixedDpr !== null || !this.resolution.update(dt)) return
    this.renderer.setPixelRatio(this.pixelRatio)
    // setPixelRatio already resizes the drawing buffer. Resize only the post targets.
    this.postfx?.setSize(this.container.clientWidth, this.container.clientHeight)
    performanceCapture.event('resolution-change', 0, { pixelRatio: this.pixelRatio })
  }

  get pixelRatio(): number {
    return renderDiagnostics.fixedDpr ?? this.resolution.ratio
  }

  /** Intro whip-pan smear (post stack only; skipped when post FX are off). */
  setWhipBlur(strength: number): void {
    this.postfx?.setWhipBlur(strength)
  }

  render(): void {
    const capture = performanceCapture.active
    const info = this.renderer.info
    const autoReset = info.autoReset
    if (capture) {
      if (!this.gpuTimer) {
        this.gpuTimer = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext)
        performanceCapture.event('gpu-timer-support', 0, this.gpuTimer.supported)
      }
      this.gpuTimer.begin()
      info.autoReset = false; info.reset()
    }
    if (this.postfx) this.postfx.render()
    else this.renderer.render(this.scene, this.camera)
    if (capture) {
      this.gpuTimer?.end()
      performanceCapture.event('render', 0, { calls: info.render.calls, triangles: info.render.triangles,
        textures: info.memory.textures, geometries: info.memory.geometries, pixelRatio: this.pixelRatio })
      info.autoReset = autoReset
    }
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container
    if (w === 0 || h === 0) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // Composer delegates to renderer.setSize only when CSS dimensions differ.
    if (this.postfx) this.postfx.setSize(w, h)
    else this.renderer.setSize(w, h)
  }

  dispose(): void {
    this.resizeObserver.disconnect()
    this.gpuTimer?.dispose()
    this.postfx?.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
