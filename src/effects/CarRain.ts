import * as THREE from 'three'
import type { CarModel } from '../vehicles/CarModel'
import { RainImpacts } from './RainImpacts'
import type { RainSurfaceUniforms } from './RainSurface'
import type { QualityPreset } from '../stores/gameStore'

export interface CarRainAnchors { positions: Float32Array; normals: Float32Array; matrix: { value: THREE.Matrix4 }; velocity: { value: THREE.Vector3 } }

/**
 * Sample the actual upper body once per model; no raycasts or buffer uploads while driving.
 * Equivalent to dropping a ray straight down the body's -Y at each sample and keeping the first
 * face it would hit (back faces culled as a Raycaster does), but done in one pass over the
 * triangles: raycasting a 500k-triangle body 160 times froze the garage for up to two seconds.
 */
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
  if (!bounds.isEmpty()) {
    const width = bounds.max.x - bounds.min.x, depth = bounds.max.z - bounds.min.z
    // A stratified, deterministic sample covers bonnet, roof and rear deck.
    const xs = new Float64Array(count), zs = new Float64Array(count)
    for (let i = 0; i < count; i++) {
      xs[i] = bounds.min.x + (.08 + .84 * ((i * .61803398875) % 1)) * width
      zs[i] = bounds.min.z + (.04 + .92 * ((i + .5) / count)) * depth
    }
    const top = new Float64Array(count).fill(-Infinity)
    const hit = new Float64Array(count * 3)
    const v = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3()
    for (const mesh of surfaces) {
      const geometry = mesh.geometry, position = geometry.getAttribute('position')
      if (!position) continue
      transform.multiplyMatrices(inverse, mesh.matrixWorld)
      // A mirrored mesh's faces wind the other way round in body space.
      const flip = transform.determinant() < 0 ? -1 : 1
      const local = new Float32Array(position.count * 3)
      for (let k = 0; k < position.count; k++) {
        v.fromBufferAttribute(position, k).applyMatrix4(transform)
        local[k * 3] = v.x; local[k * 3 + 1] = v.y; local[k * 3 + 2] = v.z
      }
      const index = geometry.index
      const materials = Array.isArray(mesh.material) ? mesh.material : null
      const groups = materials && geometry.groups.length ? geometry.groups
        : [{ start: geometry.drawRange.start, count: Math.min(geometry.drawRange.count, index ? index.count : position.count), materialIndex: 0 }]
      for (const group of groups) {
        const material = materials ? materials[group.materialIndex ?? 0] : mesh.material as THREE.Material
        if (!material) continue
        const end = Math.min(group.start + group.count, index ? index.count : position.count)
        for (let t = group.start; t + 2 < end; t += 3) {
          const a = (index ? index.getX(t) : t) * 3, b = (index ? index.getX(t + 1) : t + 1) * 3, c = (index ? index.getX(t + 2) : t + 2) * 3
          const ax = local[a], az = local[a + 2], bx = local[b], bz = local[b + 2], cx = local[c], cz = local[c + 2]
          const z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz)
          // Samples run along z in order: only those between the triangle's ends can land on it.
          const lo = Math.max(0, Math.ceil(((z0 - bounds.min.z) / depth - .04) / .92 * count - .5))
          const hi = Math.min(count - 1, Math.floor(((z1 - bounds.min.z) / depth - .04) / .92 * count - .5))
          if (lo > hi) continue
          e1.set(bx - ax, local[b + 1] - local[a + 1], bz - az)
          e2.set(cx - ax, local[c + 1] - local[a + 1], cz - az)
          n.crossVectors(e1, e2).multiplyScalar(flip)
          // A ray coming down meets a front face only where it faces up; a back face where it faces down.
          if (n.y === 0 || (material.side === THREE.FrontSide && n.y < 0) || (material.side === THREE.BackSide && n.y > 0)) continue
          const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx)
          const det = e1.x * e2.z - e2.x * e1.z
          if (det === 0) continue
          for (let i = lo; i <= hi; i++) {
            const px = xs[i] - ax, pz = zs[i] - az
            if (xs[i] < x0 || xs[i] > x1) continue
            const u = (px * e2.z - e2.x * pz) / det, w = (e1.x * pz - px * e1.z) / det
            if (u < 0 || w < 0 || u + w > 1) continue
            const y = local[a + 1] + u * e1.y + w * e2.y
            if (y <= top[i]) continue
            top[i] = y
            const l = n.length()
            hit[i * 3] = n.x / l; hit[i * 3 + 1] = n.y / l; hit[i * 3 + 2] = n.z / l
          }
        }
      }
    }
    for (let i = 0; i < count; i++) {
      if (top[i] === -Infinity || hit[i * 3 + 1] < .35) continue
      positions.push(xs[i], top[i], zs[i])
      normals.push(hit[i * 3], hit[i * 3 + 1], hit[i * 3 + 2])
    }
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
