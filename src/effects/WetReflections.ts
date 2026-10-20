import * as THREE from 'three'
import type { AnyRenderer } from '../engine/Renderer'
import type { QualityPreset } from '../stores/gameStore'

/** Local planar scene reflection. One road plane, shared by all wet road materials. */
export class WetReflections {
  readonly target = new THREE.WebGLRenderTarget(512, 256, { type: THREE.HalfFloatType })
  readonly uniforms = {
    uWetReflection: { value: this.target.texture },
    uWetReflectionMatrix: { value: new THREE.Matrix4() },
    uWetReflectionPlane: { value: new THREE.Vector4(0, 1, 0, 0) },
    uWetReflectionReady: { value: 0 },
  }
  readonly camera = new THREE.PerspectiveCamera()
  private readonly ray = new THREE.Raycaster()
  private readonly hits: THREE.Intersection[] = []
  private readonly normal = new THREE.Vector3(0, 1, 0)
  private readonly point = new THREE.Vector3()
  private readonly look = new THREE.Vector3()
  private readonly plane = new THREE.Plane()
  private readonly clip = new THREE.Vector4()
  private readonly q = new THREE.Vector4()
  private readonly inverse = new THREE.Matrix4()
  private readonly hidden: THREE.Object3D[] = []
  private elapsed = Infinity
  private interval = 1 / 15
  setQuality(quality: QualityPreset): void {
    const size = quality === 'low' ? 256 : quality === 'medium' ? 512 : 768
    this.target.setSize(size, size / 2)
    this.interval = quality === 'low' ? 1 / 10 : quality === 'medium' ? 1 / 20 : 1 / 30
    this.elapsed = Infinity
    this.uniforms.uWetReflectionReady.value = 0
  }
  update(renderer: AnyRenderer, scene: THREE.Scene, track: THREE.Object3D, camera: THREE.PerspectiveCamera, anchor: THREE.Vector3, wet: number, dt: number): void {
    this.elapsed += dt
    if (!wet) { this.uniforms.uWetReflectionReady.value = 0; this.elapsed = Infinity; return }
    if (this.elapsed < this.interval) return
    this.elapsed = 0
    this.uniforms.uWetReflectionReady.value = 0
    this.ray.ray.origin.copy(anchor).y += 2
    this.ray.ray.direction.set(0, -1, 0)
    this.ray.far = 8
    this.hits.length = 0
    track.updateWorldMatrix(true, true)
    this.ray.intersectObject(track, true, this.hits)
    const hit = this.hits.find(h => {
      const mesh = h.object as THREE.Mesh
      const mat = Array.isArray(mesh.material) ? mesh.material[h.face?.materialIndex ?? 0] : mesh.material
      return mat && (mat.userData.layer === 'road' || /asphalt|tarmac|road/i.test(mat.name))
    })
    if (!hit?.face) return
    this.point.copy(hit.point)
    this.normal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
    if (this.normal.y < 0) this.normal.negate()
    if (this.normal.y < .5) return
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.point)
    if (this.plane.distanceToPoint(camera.position) <= .05) return
    const reflected = this.camera
    camera.updateMatrixWorld()
    reflected.copy(camera, false)
    reflected.far = Math.min(camera.far, 120)
    reflected.updateProjectionMatrix()
    reflected.position.copy(camera.position).addScaledVector(this.normal, -2 * this.plane.distanceToPoint(camera.position))
    camera.getWorldDirection(this.look)
    this.look.reflect(this.normal).add(reflected.position)
    reflected.up.copy(camera.up).transformDirection(camera.matrixWorld).reflect(this.normal)
    reflected.lookAt(this.look)
    reflected.updateMatrixWorld()
    this.uniforms.uWetReflectionMatrix.value.set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1)
      .multiply(reflected.projectionMatrix).multiply(reflected.matrixWorldInverse)
    this.uniforms.uWetReflectionPlane.value.set(this.normal.x, this.normal.y, this.normal.z, this.plane.constant)
    // Oblique near plane clips geometry beneath the road. General form handles
    // both WebGL's [-1,1] and WebGPU's [0,1] depth ranges.
    this.plane.applyMatrix4(reflected.matrixWorldInverse)
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant)
    this.inverse.copy(reflected.projectionMatrix).invert()
    this.q.set(Math.sign(this.clip.x), Math.sign(this.clip.y), 1, 1).applyMatrix4(this.inverse)
    const gpu = camera.coordinateSystem === THREE.WebGPUCoordinateSystem
    this.clip.multiplyScalar((gpu ? 1 : 2) / this.clip.dot(this.q))
    const e = reflected.projectionMatrix.elements
    e[2] = this.clip.x; e[6] = this.clip.y; e[10] = this.clip.z + (gpu ? 0 : 1); e[14] = this.clip.w
    reflected.projectionMatrixInverse.copy(reflected.projectionMatrix).invert()
    const target = renderer.getRenderTarget()
    const autoClear = renderer.autoClear
    const shadowMap = renderer.shadowMap
    const shadow = 'autoUpdate' in shadowMap ? shadowMap.autoUpdate : undefined
    this.hidden.length = 0
    track.traverse(node => {
      if (!(node instanceof THREE.Mesh) || !node.visible) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      if (materials.some(mat => mat.userData.layer === 'road' || /asphalt|tarmac|road/i.test(mat.name))) {
        this.hidden.push(node); node.visible = false
      }
    })
    try {
      if ('autoUpdate' in shadowMap) shadowMap.autoUpdate = false
      renderer.autoClear = true
      renderer.setRenderTarget(this.target)
      renderer.render(scene, reflected)
      this.uniforms.uWetReflectionReady.value = 1
    } finally {
      for (const node of this.hidden) node.visible = true
      renderer.setRenderTarget(target as THREE.WebGLRenderTarget | null)
      renderer.autoClear = autoClear
      if ('autoUpdate' in shadowMap && shadow !== undefined) shadowMap.autoUpdate = shadow
    }
  }
  dispose(): void { this.target.dispose() }
}
export type WetReflectionUniforms = WetReflections['uniforms']
