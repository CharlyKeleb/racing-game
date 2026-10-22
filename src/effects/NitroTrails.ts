import * as THREE from 'three'
import type { VehicleConfig } from '../vehicles/VehicleConfig'

/** Points kept per trail (a ring buffer, sampled every rendered frame). */
const POINTS = 48
/** Seconds a trail point lives: the length of the streak at speed (~33 m at 200 km/h). */
const LIFE = 0.6

/**
 * Each trail is two ribbons on the same path, like a neon tube: a wide, deep
 * violet glow and a thin hot core inside it. Colours run from the car (0) to
 * the tail end (1); the core is above 1 so the bloom picks it up, the glow
 * mostly isn't, so it stays saturated instead of washing out to white.
 * A perfect boost burns magenta-pink.
 */
interface Layer {
  /** Ribbon half-width at the car and at the tail end, m. */
  head: number
  tail: number
  boost: THREE.Color[]
  perfect: THREE.Color[]
}
const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b)
const LAYERS: Layer[] = [
  {
    head: 0.24, tail: 0.15,
    boost: [c(0.55, 0.12, 1.25), c(0.48, 0.08, 1.15), c(0.3, 0.04, 0.85), c(0, 0, 0)],
    perfect: [c(1.2, 0.12, 0.8), c(1.0, 0.08, 0.95), c(0.55, 0.04, 0.8), c(0, 0, 0)],
  },
  {
    head: 0.065, tail: 0.03,
    boost: [c(2.4, 1.5, 3.2), c(1.5, 0.55, 2.9), c(0.85, 0.2, 2.0), c(0, 0, 0)],
    perfect: [c(3.2, 1.9, 2.7), c(2.6, 0.6, 2.0), c(1.4, 0.25, 1.7), c(0, 0, 0)],
  },
]
function trailColor(stops: THREE.Color[], t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(0.999, Math.max(0, t)) * (stops.length - 1)
  const i = Math.floor(x)
  return out.copy(stops[i]).lerp(stops[i + 1], x - i)
}

/** Where the trails leave the car, in the body's space: the tail-light corners. */
export function trailEmitters(cfg: VehicleConfig): [number, number, number][] {
  const [hx, hy, hz] = cfg.chassisHalfExtents
  const [cx, cy, cz] = cfg.chassisCenter
  // Low at the rear valance, where the exhausts and diffuser are: the ribbons hug the road.
  const y = cy - hy * 0.15
  const z = cz - hz + 0.06
  return [
    [cx + hx - 0.2, y, z],
    [cx - hx + 0.2, y, z],
  ]
}

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _view = new THREE.Vector3()
const _side = new THREE.Vector3()
const _c = new THREE.Color()

interface Trail {
  /** Emitter in the body's space. */
  local: THREE.Vector3
  /** World positions, birth times and strengths, newest at `head`. */
  pos: Float32Array
  born: Float32Array
  strength: Float32Array
  head: number
  count: number
}

/**
 * Nitro light trails, NFS Nitro style: while the boost burns, the tail lights
 * smear into long glowing ribbons that hang in the air behind the car and fade
 * out along their length. World-space ribbons turned to face the camera, every
 * trail in one draw call; additive MeshBasicMaterial, so WebGPU needs no node
 * twin. Hidden (and nothing updated) once the last point has died.
 */
export class NitroTrails {
  readonly mesh: THREE.Mesh
  private readonly trails: Trail[]
  private readonly geometry = new THREE.BufferGeometry()
  private readonly material: THREE.MeshBasicMaterial
  private readonly texture: THREE.CanvasTexture
  private readonly positions: Float32Array
  private readonly colors: Float32Array
  private time = 0

  constructor(cfg: VehicleConfig) {
    this.trails = trailEmitters(cfg).map(([x, y, z]) => ({
      local: new THREE.Vector3(x, y, z),
      pos: new Float32Array(POINTS * 3),
      born: new Float32Array(POINTS),
      strength: new Float32Array(POINTS),
      head: 0,
      count: 0,
    }))
    const ribbons = this.trails.length * LAYERS.length
    const verts = ribbons * POINTS * 2
    this.positions = new Float32Array(verts * 3)
    this.colors = new Float32Array(verts * 3)
    const uvs = new Float32Array(verts * 2)
    const index: number[] = []
    for (let r = 0; r < ribbons; r++) {
      for (let k = 0; k < POINTS; k++) {
        const v = (r * POINTS + k) * 2
        uvs[v * 2] = k / (POINTS - 1)
        uvs[v * 2 + 1] = 0
        uvs[v * 2 + 2] = k / (POINTS - 1)
        uvs[v * 2 + 3] = 1
        if (k < POINTS - 1) index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2)
      }
    }
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage))
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    this.geometry.setIndex(index)
    this.texture = ribbonTexture()
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.name = 'nitro-trails'
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
    this.mesh.visible = false
  }

  /**
   * @param body the car's leaning body node (the emitters ride on it)
   * @param intensity nitro boost, 0..1 (above 1 in a perfect boost); 0 lets the trails die out
   * @param perfect a perfect boost: the trails burn magenta
   */
  update(body: THREE.Object3D, camera: THREE.Camera, intensity: number, perfect: boolean, dt: number): void {
    this.time += dt
    const emitting = intensity > 0.05
    let alive = false
    body.updateWorldMatrix(true, false)
    for (const trail of this.trails) {
      // Age out the oldest points.
      while (trail.count > 0) {
        const oldest = (trail.head - trail.count + 1 + POINTS) % POINTS
        if (this.time - trail.born[oldest] < LIFE) break
        trail.count--
      }
      if (emitting && dt > 0) {
        trail.head = (trail.head + 1) % POINTS
        trail.count = Math.min(POINTS, trail.count + 1)
        _a.copy(trail.local).applyMatrix4(body.matrixWorld)
        trail.pos[trail.head * 3] = _a.x
        trail.pos[trail.head * 3 + 1] = _a.y
        trail.pos[trail.head * 3 + 2] = _a.z
        trail.born[trail.head] = this.time
        trail.strength[trail.head] = Math.min(1.3, intensity)
      }
      if (trail.count > 1) alive = true
    }
    this.mesh.visible = alive
    if (!alive) return

    camera.getWorldPosition(_view)
    for (let r = 0; r < this.trails.length * LAYERS.length; r++) {
      const t = r % this.trails.length
      const layer = LAYERS[(r - t) / this.trails.length]
      const stops = perfect ? layer.perfect : layer.boost
      const trail = this.trails[t]
      for (let k = 0; k < POINTS; k++) {
        const v = (r * POINTS + k) * 2
        // k = 0 is the newest point; beyond the live points the ribbon collapses onto the last one.
        const n = Math.min(k, Math.max(0, trail.count - 1))
        const i = (trail.head - n + POINTS) % POINTS
        _a.fromArray(trail.pos, i * 3)
        // Direction along the trail, from neighbours (one-sided at the ends).
        const prev = (trail.head - Math.max(0, n - 1) + POINTS) % POINTS
        const next = (trail.head - Math.min(trail.count - 1, n + 1) + POINTS) % POINTS
        _b.fromArray(trail.pos, next * 3)
        _dir.fromArray(trail.pos, prev * 3).sub(_b)
        if (_dir.lengthSq() < 1e-8) _dir.set(0, 0, 1)
        _side.subVectors(_view, _a).cross(_dir).normalize()
        const age = Math.min(1, (this.time - trail.born[i]) / LIFE)
        const along = Math.max(age, trail.count > 1 ? n / (trail.count - 1) : 1)
        const live = k < trail.count ? 1 : 0
        const width = (layer.head + (layer.tail - layer.head) * along) * (0.7 + 0.3 * trail.strength[i])
        this.positions[v * 3] = _a.x + _side.x * width
        this.positions[v * 3 + 1] = _a.y + _side.y * width
        this.positions[v * 3 + 2] = _a.z + _side.z * width
        this.positions[v * 3 + 3] = _a.x - _side.x * width
        this.positions[v * 3 + 4] = _a.y - _side.y * width
        this.positions[v * 3 + 5] = _a.z - _side.z * width
        // Additive: brightness is opacity. Shimmer a touch so it reads as energy, not a plastic strip.
        const shimmer = 0.85 + 0.15 * Math.sin(this.time * 47 + k * 0.9 + t * 2.1)
        trailColor(stops, along, _c).multiplyScalar(live * trail.strength[i] * shimmer * (1 - age * age))
        for (let s = 0; s < 2; s++) {
          this.colors[(v + s) * 3] = _c.r
          this.colors[(v + s) * 3 + 1] = _c.g
          this.colors[(v + s) * 3 + 2] = _c.b
        }
      }
    }
    this.geometry.attributes.position.needsUpdate = true
    this.geometry.attributes.color.needsUpdate = true
  }

  /** Drop every trail point (new race, reset). */
  clear(): void {
    for (const trail of this.trails) trail.count = 0
    this.mesh.visible = false
  }

  dispose(): void {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
  }
}

/** Across the ribbon: a bright core with a soft glow falling off to the edges. */
function ribbonTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 64)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.3, 'rgba(255,255,255,0.35)')
    grad.addColorStop(0.45, 'rgba(255,255,255,1)')
    grad.addColorStop(0.55, 'rgba(255,255,255,1)')
    grad.addColorStop(0.7, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 4, 64)
  }
  return new THREE.CanvasTexture(canvas)
}
