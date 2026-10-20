import * as THREE from 'three'
import type { CarModel } from '../vehicles/CarModel'
import { RainImpacts } from './RainImpacts'
import type { RainSurfaceUniforms } from './RainSurface'
import type { QualityPreset } from '../stores/gameStore'

export interface CarRainAnchors { positions: Float32Array; normals: Float32Array; matrix: { value: THREE.Matrix4 }; velocity: { value: THREE.Vector3 } }

/** Sample the actual upper body once per model; no raycasts or buffer uploads while driving. */
export function sampleCarRain(model: CarModel, count = 160): CarRainAnchors {
  model.root.updateMatrixWorld(true)
  const inverse = model.body.matrixWorld.clone().invert()
  const bounds = new THREE.Box3()
  const transform = new THREE.Matrix4()
  const surfaces: THREE.Mesh[] = []
  model.body.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    surfaces.push(node)
    node.geometry.computeBoundingBox()
    if (node.geometry.boundingBox) bounds.union(node.geometry.boundingBox.clone().applyMatrix4(transform.multiplyMatrices(inverse, node.matrixWorld)))
  })
  const positions: number[] = [], normals: number[] = []
  const ray = new THREE.Raycaster()
  const origin = new THREE.Vector3(), direction = new THREE.Vector3(0, -1, 0).transformDirection(model.body.matrixWorld)
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3()
  const hits: THREE.Intersection[] = []
  if (!bounds.isEmpty()) for (let i = 0; i < count; i++) {
    // A stratified, deterministic sample covers bonnet, roof and rear deck.
    const x = bounds.min.x + (.08 + .84 * ((i * .61803398875) % 1)) * (bounds.max.x - bounds.min.x)
    const z = bounds.min.z + (.04 + .92 * ((i + .5) / count)) * (bounds.max.z - bounds.min.z)
    origin.set(x, bounds.max.y + .2, z).applyMatrix4(model.body.matrixWorld)
    ray.set(origin, direction)
    hits.length = 0
    // Lamp sprites need a camera for raycasting and are not body surfaces.
    ray.intersectObjects(surfaces, false, hits)
    const hit = hits[0]
    if (!hit?.face) continue
    normal.copy(hit.face.normal).applyNormalMatrix(normalMatrix.getNormalMatrix(hit.object.matrixWorld)).transformDirection(inverse)
    if (normal.y < .35) continue
    point.copy(hit.point).applyMatrix4(inverse)
    positions.push(point.x, point.y, point.z)
    normals.push(normal.x, normal.y, normal.z)
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), matrix: { value: new THREE.Matrix4() }, velocity: { value: new THREE.Vector3() } }
}

export class CarRain {
  readonly impacts: RainImpacts
  private readonly anchors: CarRainAnchors
  private wet = false
  private hasPrevious = false
  private readonly previous = new THREE.Vector3()
  private readonly position = new THREE.Vector3()
  private readonly paint: { material: THREE.MeshPhysicalMaterial; roughness: number; clearcoat: number; clearcoatRoughness: number }[] = []
  constructor(privateModel: CarModel, surface: RainSurfaceUniforms) {
    const seen = new Set<THREE.Material>()
    privateModel.body.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        if (material.name !== 'livery_paint' || seen.has(material)) continue
        seen.add(material)
        const paint = material as THREE.MeshPhysicalMaterial
        this.paint.push({ material: paint, roughness: paint.roughness, clearcoat: paint.clearcoat, clearcoatRoughness: paint.clearcoatRoughness })
      }
    })
    this.anchors = sampleCarRain(privateModel)
    this.impacts = new RainImpacts(surface, this.anchors)
  }
  update(model: CarModel, wet: number, dt = 1 / 60): void {
    if ((wet > 0) !== this.wet) {
      this.wet = wet > 0
      for (const paint of this.paint) {
        if (this.wet) {
          paint.roughness = paint.material.roughness
          paint.clearcoat = paint.material.clearcoat
          paint.clearcoatRoughness = paint.material.clearcoatRoughness
          paint.material.roughness = Math.min(.18, paint.roughness)
          paint.material.clearcoat = 1
          paint.material.clearcoatRoughness = .06
        } else this.restorePaint(paint)
        // Enabling a coat on a matte build changes the shader variant.
        if (paint.clearcoat === 0) paint.material.needsUpdate = true
      }
    }
    model.body.updateWorldMatrix(true, false)
    this.anchors.matrix.value.copy(model.body.matrixWorld)
    this.position.setFromMatrixPosition(model.body.matrixWorld)
    const velocity = this.anchors.velocity.value
    if (this.hasPrevious && dt > 0) {
      velocity.subVectors(this.position, this.previous).multiplyScalar(1 / dt)
      if (velocity.lengthSq() > 120 * 120) velocity.set(0, 0, 0)
    } else velocity.set(0, 0, 0)
    this.previous.copy(this.position)
    this.hasPrevious = wet > 0
    this.impacts.mesh.visible = wet > 0 && this.anchors.positions.length > 0
  }
  setQuality(quality: QualityPreset): void { this.impacts.setQuality(quality) }
  private restorePaint(paint: CarRain['paint'][number]): void {
    paint.material.roughness = paint.roughness
    paint.material.clearcoat = paint.clearcoat
    paint.material.clearcoatRoughness = paint.clearcoatRoughness
  }
  dispose(): void {
    if (this.wet) for (const paint of this.paint) { this.restorePaint(paint); paint.material.needsUpdate = true }
    this.impacts.dispose()
  }
}
