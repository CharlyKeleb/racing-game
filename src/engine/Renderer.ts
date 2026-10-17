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

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
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
    const ratio = quality === 'low' ? 1 : quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2)
    this.renderer.setPixelRatio(ratio)
    this.renderer.shadowMap.enabled = quality !== 'low'
    this.postfxEnabled = postfx
    this.renderer.toneMapping = postfx ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping
    this.resize()
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
