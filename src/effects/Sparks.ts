import { createParticles, particleBudget, type ParticleSpawn, type ParticleSystem } from './Particles'

/** Sliding speed (m/s) along a wall or the road below which metal doesn't throw sparks. */
const SCRAPE_MIN_SPEED = 3
/** Scrape sparks per second per m/s of sliding speed above the minimum. */
const SCRAPE_RATE = 28
/** Change in speed (m/s) in one tick that counts as a hit and throws a burst. */
const HIT_MIN_DV = 0.6
/** Burst sparks per m/s of change in speed. */
const HIT_RATE = 40
const MAX_BURST = 220

/**
 * How many sparks a contact throws this tick: a stream while sliding against
 * something (rate × time) plus a burst on a hard hit. Fractional counts carry
 * over through `carry` so slow scrapes still spit the odd spark.
 */
export function sparkCount(dv: number, slideSpeed: number, dt: number, carry = 0): number {
  const stream = Math.max(0, slideSpeed - SCRAPE_MIN_SPEED) * SCRAPE_RATE * dt
  const burst = dv > HIT_MIN_DV ? Math.min(MAX_BURST, (dv - HIT_MIN_DV) * HIT_RATE + 12) : 0
  return stream + burst + carry
}

/** One chassis contact, in world space. */
export interface SparkContact {
  x: number
  y: number
  z: number
  /** Surface normal, pointing out of what was hit (toward the car). */
  nx: number
  ny: number
  nz: number
  /** Car velocity, m/s. */
  vx: number
  vy: number
  vz: number
  /** Change in speed from the contact this tick, m/s. */
  dv: number
  /** Road height under the contact: sparks skip off it. */
  groundY: number
}

const _spawn: ParticleSpawn = {
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, startSize: 0, endSize: 0, alpha: 1,
  r: 1, g: 1, b: 1, lift: -9.81, drag: 0.5, bounce: 0.35,
}

/**
 * Sparks from metal on a wall or the road (#52): a stream that follows the
 * sliding speed while scraping, a burst on a hard hit. Bright additive streaks
 * with gravity that skip off the road; bloom makes them glow at night.
 */
export class Sparks {
  private readonly pool: ParticleSystem
  /** Fractional sparks owed per emitter slot (car), so slow scrapes still spark. */
  private readonly carry = new Float32Array(16)
  /** GPU particles (#51) throw this many times more: thousands per hit. */
  private readonly scale = Math.min(particleBudget(), 8)

  constructor(max = 1500) {
    this.pool = createParticles(max, 'spark', 3, [0.3, 1.2])
    this.pool.mesh.name = 'sparks'
  }

  get mesh() {
    return this.pool.mesh
  }

  /** Throw sparks from one contact this tick. `slot` keys the fractional carry (one per car). */
  emit(c: SparkContact, dt: number, slot = 0): void {
    // Velocity along the surface: sparks shoot on in the direction of the slide.
    const vn = c.vx * c.nx + c.vy * c.ny + c.vz * c.nz
    const tx = c.vx - vn * c.nx, ty = c.vy - vn * c.ny, tz = c.vz - vn * c.nz
    const slide = Math.hypot(tx, ty, tz)
    const total = sparkCount(c.dv, slide, dt, this.carry[slot] / this.scale) * this.scale
    const n = Math.floor(total)
    this.carry[slot] = Math.min(total - n, this.scale)
    if (n === 0) return
    const inv = slide > 1e-3 ? 1 / slide : 0
    const burst = c.dv > HIT_MIN_DV ? c.dv : 0
    for (let i = 0; i < n; i++) {
      // Most of the slide speed carries on, fanned out; a kick off the surface
      // and upward; a hit adds a spray in every direction off the surface.
      const keep = 0.35 + Math.random() * 0.55
      const off = 0.6 + Math.random() * 2.4 + burst * Math.random() * 0.8
      const rx = Math.random() * 2 - 1, ry = Math.random(), rz = Math.random() * 2 - 1
      const scatter = 1.4 + burst * 0.9
      _spawn.x = c.x + (Math.random() - 0.5) * 0.15
      _spawn.y = c.y + Math.random() * 0.05
      _spawn.z = c.z + (Math.random() - 0.5) * 0.15
      _spawn.vx = tx * inv * slide * keep + c.nx * off + rx * scatter
      _spawn.vy = ty * inv * slide * keep + c.ny * off + ry * scatter * 1.4 + 0.8
      _spawn.vz = tz * inv * slide * keep + c.nz * off + rz * scatter
      _spawn.life = 0.22 + Math.random() * 0.5
      _spawn.startSize = _spawn.endSize = 0.018 + Math.random() * 0.03
      _spawn.alpha = 0.7 + Math.random() * 0.3
      this.pool.spawn(_spawn, c.groundY)
    }
  }

  update(dt: number): void {
    this.pool.update(dt)
  }

  clear(): void {
    this.pool.clear()
    this.carry.fill(0)
  }

  dispose(): void {
    this.pool.mesh.removeFromParent()
    this.pool.dispose()
  }
}
