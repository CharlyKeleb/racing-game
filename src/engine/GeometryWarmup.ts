import * as THREE from 'three'
import type { AnyRenderer } from './Renderer'

/** Upload geometry through the public renderer API before it becomes visible. */
export class GeometryWarmup {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera()
  private readonly material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, toneMapped: false })
  private readonly placeholder = new THREE.BufferGeometry()
  private readonly mesh = new THREE.Mesh(this.placeholder, this.material)
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, stencilBuffer: false })
  private readonly viewport = new THREE.Vector4()
  private readonly scissor = new THREE.Vector4()
  private readonly uploaded = new WeakSet<THREE.BufferGeometry>()

  private readonly renderer: THREE.WebGLRenderer

  /** Either renderer: WebGPURenderer has the same render-target / viewport / scissor API used here. */
  constructor(renderer: AnyRenderer) {
    this.renderer = renderer as THREE.WebGLRenderer
    this.mesh.frustumCulled = false
    this.scene.add(this.mesh)
  }

  /** Returns bytes submitted; a single geometry upload cannot be interrupted. */
  upload(geometry: THREE.BufferGeometry): number {
    if (this.uploaded.has(geometry)) return 0
    let bytes = geometry.index?.array.byteLength ?? 0
    for (const attribute of Object.values(geometry.attributes)) {
      bytes += attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array.byteLength : attribute.array.byteLength
    }
    const renderer = this.renderer
    const target = renderer.getRenderTarget()
    const face = renderer.getActiveCubeFace()
    const mip = renderer.getActiveMipmapLevel()
    renderer.getViewport(this.viewport)
    renderer.getScissor(this.scissor)
    const scissorTest = renderer.getScissorTest()
    const autoClear = renderer.autoClear
    const shadows = renderer.shadowMap.enabled
    const autoReset = renderer.info.autoReset
    try {
      renderer.autoClear = true
      renderer.shadowMap.enabled = false
      renderer.info.autoReset = false
      renderer.setRenderTarget(this.target)
      renderer.setScissorTest(false)
      this.mesh.geometry = geometry
      renderer.render(this.scene, this.camera)
      this.uploaded.add(geometry)
    } finally {
      this.mesh.geometry = this.placeholder
      renderer.setRenderTarget(target, face, mip)
      renderer.setViewport(this.viewport)
      renderer.setScissor(this.scissor)
      renderer.setScissorTest(scissorTest)
      renderer.autoClear = autoClear
      renderer.shadowMap.enabled = shadows
      renderer.info.autoReset = autoReset
    }
    return bytes
  }

  dispose(): void {
    this.target.dispose()
    this.material.dispose()
    this.placeholder.dispose()
  }
}
