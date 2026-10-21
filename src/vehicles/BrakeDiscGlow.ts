import * as THREE from 'three'
import type { CarModel } from './CarModel'
import type { VehicleConfig, WheelId } from './VehicleConfig'

/** Dull red when the discs first glow, orange when they're really hot. Kept short of white under ACES. */
const COOL = new THREE.Color(0.6, 0.05, 0)
const HOT = new THREE.Color(1, 0.3, 0.04)
/** Emissive intensity at full glow on a disc material (config can scale it). */
const MAX_INTENSITY = 0.9
/** Fallback ring between these shares of the wheel radius: the disc's swept face. */
const RING_INNER = 0.3
const RING_OUTER = 0.56

const _color = new THREE.Color()

type Axle = 'front' | 'rear'
const axleOf = (id: WheelId): Axle => (id[0] === 'F' ? 'front' : 'rear')

/**
 * Glows the brake discs from BrakeHeat (#92). Where the car's wheels have a
 * disc material (`brakeDisc.material` in vehicle-config.json), each axle gets
 * its own copy of it with an emissive glow; calipers, rims, tyres and tail
 * lamps are untouched. Wheels without one (an LOD that dropped the disc, or a
 * model with none) get a thin additive ring behind the spokes, drawn only while
 * it glows. Standard and basic materials only, so WebGPU needs no node twin.
 */
export class BrakeDiscGlow {
  private readonly materials: Record<Axle, THREE.MeshStandardMaterial[]> = { front: [], rear: [] }
  private readonly rings: Record<Axle, THREE.Mesh[]> = { front: [], rear: [] }
  private readonly ringMaterials: Record<Axle, THREE.MeshBasicMaterial | null> = { front: null, rear: null }
  private ringGeometry: THREE.RingGeometry | null = null
  private ringTexture: THREE.Texture | null = null
  private readonly intensity: number

  constructor(model: CarModel, config: VehicleConfig) {
    this.intensity = MAX_INTENSITY * (config.brakeDisc?.intensity ?? 1)
    const name = config.brakeDisc?.material
    /** One copy per source material per axle, so front and rear heat separately. */
    const copies = new Map<THREE.Material, Record<Axle, THREE.MeshStandardMaterial>>()
    for (const wheel of config.wheels) {
      const rig = model.wheels[wheel.id]
      if (!rig) continue
      const axle = axleOf(wheel.id)
      let found = false
      if (name) {
        rig.spinner.traverse((o) => {
          const mesh = o as THREE.Mesh
          const mat = mesh.material as THREE.MeshStandardMaterial
          if (!mesh.isMesh || Array.isArray(mat) || !mat?.isMeshStandardMaterial || mat.name !== name) return
          let pair = copies.get(mat)
          if (!pair) {
            pair = { front: this.copy(mat, 'front'), rear: this.copy(mat, 'rear') }
            copies.set(mat, pair)
          }
          mesh.material = pair[axle]
          found = true
        })
      }
      if (!found) this.addRing(rig.spinner, axle, wheel.radius)
    }
  }

  private copy(source: THREE.MeshStandardMaterial, axle: Axle): THREE.MeshStandardMaterial {
    const own = source.clone()
    own.emissive.setRGB(0, 0, 0)
    own.emissiveMap = null // a baked texture would tint the glow
    own.emissiveIntensity = 0
    this.materials[axle].push(own)
    return own
  }

  private addRing(spinner: THREE.Object3D, axle: Axle, radius: number): void {
    this.ringGeometry ??= new THREE.RingGeometry(RING_INNER, RING_OUTER, 40, 1).rotateY(Math.PI / 2)
    // Not tone-mapped: ACES pushed an additive orange toward pale peach. The texture
    // shapes it like real hot iron: brightest across the pad's swept band, with grooves.
    this.ringTexture ??= sweptBandTexture()
    const material = (this.ringMaterials[axle] ??= new THREE.MeshBasicMaterial({
      color: COOL, map: this.ringTexture, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }))
    const ring = new THREE.Mesh(this.ringGeometry, material)
    ring.name = 'BrakeDiscGlow'
    ring.scale.setScalar(radius)
    ring.visible = false
    spinner.add(ring)
    this.rings[axle].push(ring)
  }

  /** Glow 0..1 per axle (brakeGlow of BrakeHeat). */
  update(front: number, rear: number): void {
    this.apply('front', front)
    this.apply('rear', rear)
  }

  private apply(axle: Axle, glow: number): void {
    _color.copy(COOL).lerp(HOT, glow)
    for (const mat of this.materials[axle]) {
      mat.emissive.copy(_color)
      mat.emissiveIntensity = glow * this.intensity
    }
    const ring = this.ringMaterials[axle]
    if (ring) {
      // Dimmer than the material path: the ring adds light over whatever is behind the spokes.
      ring.color.copy(_color).multiplyScalar(0.85)
      ring.opacity = 0.8 * glow
      for (const mesh of this.rings[axle]) mesh.visible = glow > 0.01
    }
  }

  /** Disc copies and rings belong to this; the model's own materials are shared and left alone. */
  dispose(): void {
    for (const axle of ['front', 'rear'] as const) {
      for (const mat of this.materials[axle]) mat.dispose()
      this.ringMaterials[axle]?.dispose()
      for (const ring of this.rings[axle]) ring.removeFromParent()
    }
    this.ringGeometry?.dispose()
    this.ringTexture?.dispose()
  }

  /** How each axle is drawn, for tests and the debug overlay. */
  get layout(): { discMaterials: number; rings: number } {
    return { discMaterials: this.materials.front.length + this.materials.rear.length, rings: this.rings.front.length + this.rings.rear.length }
  }
}

/**
 * Radial brightness for the fallback ring. RingGeometry maps its outer radius
 * to the texture's edge, so the inner edge sits at RING_INNER / RING_OUTER.
 */
function sweptBandTexture(): THREE.Texture {
  const size = 128
  const data = new Uint8Array(size * size * 4)
  const inner = RING_INNER / RING_OUTER
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2)
    // Brightest across the middle of the band, falling off to both edges.
    const t = (r - inner) / (1 - inner)
    const band = t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t) ** 0.7
    // Faint concentric machining grooves.
    const grooves = 0.85 + 0.15 * Math.sin(r * 190)
    const v = Math.round(255 * band * grooves)
    const o = (y * size + x) * 4
    data[o] = data[o + 1] = data[o + 2] = v
    data[o + 3] = 255
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.needsUpdate = true
  return texture
}
