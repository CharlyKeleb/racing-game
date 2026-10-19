import { LicensePlate } from './LicensePlate'
import * as THREE from 'three'
import { DEFAULT_BUILD, type CarBuild, type PaintFinish } from './CarBuild'
import type { CarModel } from './CarModel'
import { hasLivery, LIVERY_PLACEMENTS } from './LiveryDesign'
import { LiveryGraphics, LIVERY_VERTEX_DECLARATIONS, LIVERY_FRAGMENT_DECLARATIONS, LIVERY_FRAGMENT } from './LiveryGraphics'

/**
 * Glues CarBuild's visual fields onto a rigged model. Meshes are matched by
 * glTF material name (see docs/ASSET_PIPELINE.md): `paint` is the body,
 * `silver` under a wheel is the rim, `caliper*` the calipers, and
 * `glass`/`window` the windows. Each slot gets one owned material, so
 * repainting never touches the cached GLB.
 */

const FINISH: Record<PaintFinish, Partial<THREE.MeshPhysicalMaterialParameters>> = {
  gloss: { metalness: 0.25, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0 },
  metallic: { metalness: 0.85, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0 },
  matte: { metalness: 0.2, roughness: 0.75, clearcoat: 0, clearcoatRoughness: 0, iridescence: 0 },
  pearl: { metalness: 0.6, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 1, iridescenceIOR: 1.35 },
}

type Slot = 'paint' | 'rims' | 'calipers' | 'glass'

function slotFor(materialName: string, onWheel: boolean): Slot | null {
  const n = materialName.toLowerCase()
  if (n === 'paint' || n.startsWith('paint.')) return 'paint'
  if (n.startsWith('caliper')) return 'calipers'
  if (n === 'glass' || n === 'window' || n.startsWith('glass.') || n.startsWith('window.')) return 'glass'
  if (onWheel && (n === 'silver' || n.startsWith('rim'))) return 'rims'
  return null
}

export class CarLivery {
  private readonly paint = new THREE.MeshPhysicalMaterial({ name: 'livery_paint' })
  private readonly rims = new THREE.MeshStandardMaterial({ name: 'livery_rims', metalness: 1, roughness: 0.22 })
  private readonly calipers = new THREE.MeshStandardMaterial({ name: 'livery_calipers', metalness: 0.3, roughness: 0.4 })
  private readonly glass = new THREE.MeshPhysicalMaterial({
    name: 'livery_glass',
    color: 0x05080b,
    metalness: 0.1,
    roughness: 0.04,
    transparent: true,
    depthWrite: false,
  })

  private readonly licensePlate: LicensePlate
  private graphics?: LiveryGraphics
  private stockMap: THREE.Texture | null = null
  private finish?: PaintFinish
  private readonly originals: { mesh: THREE.Mesh; material: THREE.Material | THREE.Material[]; geometry: THREE.BufferGeometry }[] = []

  constructor(model: CarModel) {
    const placement = LIVERY_PLACEMENTS[model.root.name]
    if (placement) {
      this.graphics = new LiveryGraphics(placement)
      const graphics = this.graphics
      this.paint.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, graphics.uniforms)
        shader.vertexShader = LIVERY_VERTEX_DECLARATIONS + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLiveryPosition = liveryPosition;\nvLiveryNormal = liveryNormal;')
        shader.fragmentShader = LIVERY_FRAGMENT_DECLARATIONS + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + LIVERY_FRAGMENT)
      }
      this.paint.customProgramCacheKey = () => 'garage-livery-v1'
    }
    model.root.updateMatrixWorld(true)
    const bodyInverse = model.body.matrixWorld.clone().invert()

    const wheelNodes = new Set<THREE.Object3D>(Object.values(model.wheels).map((w) => w.spinner))
    const slots: Record<Slot, THREE.Material> = {
      paint: this.paint,
      rims: this.rims,
      calipers: this.calipers,
      glass: this.glass,
    }
    const visit = (o: THREE.Object3D, onWheel: boolean) => {
      const wheel = onWheel || wheelNodes.has(o)
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        const originalMaterial = mesh.material
        let painted = false
        const swap = (m: THREE.Material) => {
          const alias = placement?.paintAliases.includes(m.name) ?? false
          const slot = alias ? 'paint' : slotFor(m.name, wheel)
          if (slot === 'paint') {
            painted = true
            if (alias && m instanceof THREE.MeshStandardMaterial) this.stockMap = m.map
          }
          return slot ? slots[slot] : m
        }
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
        this.originals.push({ mesh, material: originalMaterial, geometry: mesh.geometry })
        if (painted && this.graphics) {
          const geometry = mesh.geometry.clone()
          const transform = new THREE.Matrix4().multiplyMatrices(bodyInverse, mesh.matrixWorld)
          const normalTransform = new THREE.Matrix3().getNormalMatrix(transform)
          const positions = geometry.getAttribute('position')
          const normals = geometry.getAttribute('normal')
          const projected = new Float32Array(positions.count * 3)
          const projectedNormals = new Float32Array(positions.count * 3)
          const point = new THREE.Vector3()
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(transform).toArray(projected, i * 3)
            if (normals) point.fromBufferAttribute(normals, i).applyNormalMatrix(normalTransform)
            else point.set(0, 1, 0)
            point.toArray(projectedNormals, i * 3)
          }
          geometry.setAttribute('liveryPosition', new THREE.BufferAttribute(projected, 3))
          geometry.setAttribute('liveryNormal', new THREE.BufferAttribute(projectedNormals, 3))
          mesh.geometry = geometry
        }
      }
      for (const child of o.children) visit(child, wheel)
    }
    visit(model.root, false)
    this.licensePlate = new LicensePlate(model)
  }

  apply(build: CarBuild): void {
    const map = this.stockMap && build.paint === DEFAULT_BUILD.paint && !hasLivery(build.livery) ? this.stockMap : null
    if (this.paint.map !== map) { this.paint.map = map; this.paint.needsUpdate = true }
    this.paint.color.set(map ? '#ffffff' : build.paint)
    if (this.finish !== build.finish) {
      this.paint.setValues(FINISH[build.finish])
      this.paint.needsUpdate = true
      this.finish = build.finish
    }
    this.graphics?.apply(build.livery)
    this.licensePlate.apply(build.livery)
    this.rims.color.set(build.rims)
    this.calipers.color.set(build.calipers)
    this.glass.opacity = 0.3 + 0.65 * build.tint
  }

  dispose(): void {
    for (const { mesh, material, geometry } of this.originals) {
      if (mesh.geometry !== geometry) mesh.geometry.dispose()
      mesh.geometry = geometry
      mesh.material = material
    }
    this.licensePlate.dispose()
    this.graphics?.dispose()
    this.paint.dispose()
    this.rims.dispose()
    this.calipers.dispose()
    this.glass.dispose()
  }
}
