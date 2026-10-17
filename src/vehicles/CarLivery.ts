import * as THREE from 'three'
import type { CarBuild, PaintFinish } from './CarBuild'
import type { CarModel } from './CarModel'

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

  constructor(model: CarModel) {
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
        const swap = (m: THREE.Material) => {
          const slot = slotFor(m.name, wheel)
          return slot ? slots[slot] : m
        }
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
      }
      for (const child of o.children) visit(child, wheel)
    }
    visit(model.root, false)
  }

  apply(build: CarBuild): void {
    this.paint.color.set(build.paint)
    this.paint.setValues(FINISH[build.finish])
    this.paint.needsUpdate = true
    this.rims.color.set(build.rims)
    this.calipers.color.set(build.calipers)
    this.glass.opacity = 0.3 + 0.65 * build.tint
  }

  dispose(): void {
    this.paint.dispose()
    this.rims.dispose()
    this.calipers.dispose()
    this.glass.dispose()
  }
}
