import { AdaptiveResolution } from './AdaptiveResolution'
import { renderDiagnostics } from './renderDiagnostics'
import { GpuTimer } from './GpuTimer'
import { performanceCapture } from './PerformanceCapture'
import * as THREE from 'three'
import type { WebGPURenderer } from 'three/webgpu'
import { PostFX, type HazeSource } from '../effects/PostFX'
import type { QualityPreset } from '../stores/gameStore'
import { backend, type RendererKind } from './backend'

/** Either renderer: the classic WebGL one, or WebGPURenderer (Settings → Renderer). */
export type AnyRenderer = THREE.WebGLRenderer | WebGPURenderer

/**
 * three r186 sets `swizzle: 'rgba'` on every texture view (the identity,
 * meant to be ignored without the 'texture-component-swizzle' feature), but
 * Chrome ~141 types that member as a dictionary and throws on the string,
 * failing the first frame. Dropping the identity changes nothing elsewhere.
 */
function dropIdentitySwizzle(): void {
  const GPUTexture = (globalThis as { GPUTexture?: { prototype: { createView(d?: { swizzle?: unknown }): unknown } } }).GPUTexture
  if (!GPUTexture || (GPUTexture.prototype as { swizzlePatched?: boolean }).swizzlePatched) return
  const createView = GPUTexture.prototype.createView
  GPUTexture.prototype.createView = function (this: unknown, d?: { swizzle?: unknown }) {
    if (d && d.swizzle === 'rgba') delete d.swizzle
    return createView.call(this, d)
  }
  ;(GPUTexture.prototype as { swizzlePatched?: boolean }).swizzlePatched = true
}

const WEBGPU_LOST_KEY = 'racing-game:webgpu-lost'

/** The WebGPU device was lost earlier in this tab: stay on WebGL until it's closed. */
function webgpuLostThisSession(): boolean {
  try { return sessionStorage.getItem(WEBGPU_LOST_KEY) === '1' } catch { return false }
}

/** Highest texture anisotropy the GPU supports, on either renderer. */
export function maxAnisotropy(renderer: AnyRenderer): number {
  return 'capabilities' in renderer ? renderer.capabilities.getMaxAnisotropy() : renderer.getMaxAnisotropy()
}

interface PostStack {
  setMotionBlur(exposure: number, player: THREE.Object3D | null): void
  setHaze(haze: HazeSource | null): void
  setSize(w: number, h: number): void
  render(): void
  dispose(): void
}

/**
 * Owns the renderer, scene, camera and post stack. WebGL is ready at
 * construction; WebGPU needs `await init()` (device request, lazy-loaded node
 * module) and falls back to WebGL if that fails.
 */
export class Renderer {
  /** Set at construction (WebGL) or by init() (WebGPU). */
  renderer!: AnyRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000)
  private readonly requested: RendererKind
  private gpuTimer?: GpuTimer
  private postfx?: PostStack
  private haze: HazeSource | null = null
  private quality?: QualityPreset
  private displayDpr = 1
  private resolution = new AdaptiveResolution('high', 1)
  private readonly resizeObserver: ResizeObserver
  private readonly container: HTMLElement

  constructor(container: HTMLElement, kind: RendererKind = 'webgl') {
    this.container = container
    this.requested = kind
    backend.kind = 'webgl'
    backend.nodes = null
    backend.renderer = null
    if (kind === 'webgl') this.setup(this.createWebGL())

    // Image-based lighting comes from world/Environment (sky-baked, per time of day).

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
  }

  /**
   * Ready to draw. WebGPU: checks for an adapter, loads the node module and
   * starts the device, falling back to the classic WebGL renderer if any step
   * fails. WebGPURenderer's own WebGL 2 backend isn't used: it emulates compute
   * with transform feedback, which can't run the GPU particles, and the
   * classic renderer is the better WebGL path anyway. Must finish before any
   * scene content is built: effects pick their material by `backend.kind`.
   */
  async init(): Promise<void> {
    if (this.renderer) return
    try {
      if (webgpuLostThisSession()) throw new Error('the WebGPU device was lost earlier this session')
      const gpu = (navigator as { gpu?: { requestAdapter(o?: object): Promise<unknown> } }).gpu
      if (!gpu || !(await gpu.requestAdapter({ powerPreference: 'high-performance' }))) throw new Error('no WebGPU adapter')
      dropIdentitySwizzle()
      const nodes = await import('./nodes')
      const renderer = new nodes.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' })
      await renderer.init()
      if (!(renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend) {
        renderer.dispose()
        throw new Error('WebGPURenderer fell back to WebGL 2')
      }
      // A lost device (driver reset, GPU switched or removed) can't be
      // recovered in place: reload on WebGL for the rest of the session.
      renderer.onDeviceLost = (info: { message: string; reason: string | null }) => {
        console.error('[Renderer] WebGPU device lost, reloading on WebGL:', info.reason ?? '', info.message)
        try { sessionStorage.setItem(WEBGPU_LOST_KEY, '1') } catch { /* private mode: the reload just tries WebGPU again */ }
        location.reload()
      }
      backend.kind = 'webgpu'
      backend.nodes = nodes
      backend.renderer = renderer
      this.setup(renderer)
    } catch (err) {
      console.warn('[Renderer] WebGPU unavailable, using WebGL:', err instanceof Error ? err.message : err)
      this.setup(this.createWebGL())
    }
  }

  /** What's actually drawing: 'webgl', 'webgpu', or 'webgl (webgpu unavailable)' when the setting couldn't be honoured. */
  get backendName(): string {
    if (backend.kind === 'webgpu') return 'webgpu'
    return this.requested === 'webgpu' ? 'webgl (webgpu unavailable)' : 'webgl'
  }

  private createWebGL(): THREE.WebGLRenderer {
    return new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false })
  }

  private setup(renderer: AnyRenderer): void {
    this.renderer = renderer
    renderer.outputColorSpace = THREE.SRGBColorSpace
    // WebGL: tone mapping is applied by the post stack when it's on; see PostFX.
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    this.container.appendChild(renderer.domElement)
    this.resize()
  }

  /** Draw calls and triangles of the last frame, every pass included, on either renderer. */
  readonly frameStats = { calls: 0, triangles: 0 }

  /** Draw calls in the renderer's counters (the two renderers count them under different names). */
  get drawCalls(): number {
    const render = this.renderer.info.render as { calls: number; drawCalls?: number }
    return backend.kind === 'webgpu' ? render.drawCalls ?? 0 : render.calls
  }

  applyQuality(quality: QualityPreset, postfx: boolean): void {
    // WebGPU still starting: Game.init applies the settings once it's up.
    if (!this.renderer) return
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
      const preset = renderDiagnostics.postfxQuality ?? quality
      this.postfx = backend.nodes
        ? new backend.nodes.NodePostFX(this.renderer as WebGPURenderer, this.scene, this.camera, preset)
        : new PostFX(this.renderer as THREE.WebGLRenderer, this.scene, this.camera, preset)
      // The constructor sizes from the renderer's existing drawing buffer.
      this.postfx.setHaze(this.haze)
    }
    if (backend.kind === 'webgl') {
      // postprocessing tone-maps in its own pass; the node stack reads renderer.toneMapping.
      this.renderer.toneMapping = enabled ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
      this.renderer.autoClear = !enabled
    }
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

  /** Heat haze behind the exhausts (#56), drawn by the post stack; none with post FX off. */
  setHaze(haze: HazeSource | null): void {
    this.haze = haze
    this.postfx?.setHaze(haze)
  }

  setMotionBlur(exposure: number, player: THREE.Object3D | null): void {
    this.postfx?.setMotionBlur(exposure, player)
  }

  private viewOpacity = 1
  setViewOpacity(opacity: number): void {
    if (opacity === this.viewOpacity) return
    this.viewOpacity = opacity
    this.renderer.domElement.style.opacity = String(opacity)
  }

  render(): void {
    const capture = performanceCapture.active
    const info = this.renderer.info
    const autoReset = info.autoReset
    if (capture && backend.kind === 'webgl') {
      if (!this.gpuTimer) {
        this.gpuTimer = new GpuTimer((this.renderer as THREE.WebGLRenderer).getContext() as WebGL2RenderingContext)
        performanceCapture.event('gpu-timer-support', 0, this.gpuTimer.supported)
      }
      this.gpuTimer.begin()
    }
    // Count the whole frame, every post pass included. WebGPU otherwise resets
    // its counters from its own animation loop, out of step with ours.
    info.autoReset = false
    info.reset()
    if (this.postfx) this.postfx.render()
    else this.renderer.render(this.scene, this.camera)
    this.frameStats.calls = this.drawCalls
    this.frameStats.triangles = info.render.triangles
    info.autoReset = autoReset
    if (capture) {
      this.gpuTimer?.end()
      performanceCapture.event('render', 0, { calls: this.frameStats.calls, triangles: this.frameStats.triangles, backend: this.backendName,
        textures: info.memory.textures, geometries: info.memory.geometries, pixelRatio: this.pixelRatio })
    }
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container
    if (w === 0 || h === 0 || !this.renderer) return
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
    this.renderer?.dispose()
    this.renderer?.domElement.remove()
  }
}
