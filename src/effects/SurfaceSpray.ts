import { Surface, surfaceProps } from '../vehicles/Surface'
import type { WheelState } from '../vehicles/VehicleController'
import { ParticlePool, type ParticleSpawn } from './Particles'

const MAX_GRAINS = 900
const MAX_DUST = 420
/** Below this ground speed (m/s) a tire doesn't throw anything. */
const MIN_CHURN = 2
/** Grains / dust puffs per second per wheel at full churn on the loosest surface. */
const GRAIN_RATE = 130
const DUST_RATE = 16
const GRAVITY = -9.81
const WIND_X = 0.5
const WIND_Z = 0.25

/** Base colours (linear-ish RGB) of what each loose surface throws up. */
const GRAIN_COLOR: Partial<Record<Surface, [number, number, number]>> = {
  [Surface.Sand]: [0.74, 0.62, 0.42],
  [Surface.Gravel]: [0.52, 0.49, 0.44],
  [Surface.Grass]: [0.3, 0.27, 0.17],
  [Surface.None]: [0.3, 0.27, 0.17],
}
const DUST_COLOR: Partial<Record<Surface, [number, number, number]>> = {
  [Surface.Sand]: [0.8, 0.71, 0.55],
  [Surface.Gravel]: [0.66, 0.63, 0.58],
  [Surface.Grass]: [0.52, 0.47, 0.36],
  [Surface.None]: [0.52, 0.47, 0.36],
}

const _p: ParticleSpawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, startSize: 1, endSize: 1, alpha: 1, r: 1, g: 1, b: 1, lift: 0, drag: 0 }

/**
 * What a tire throws up off the tarmac. Two layers, like the real thing:
 *  - grains: sand / gravel (or soil clods on grass) flicked up off the tread in
 *    ballistic arcs that fall back and settle — a rooster tail at speed;
 *  - dust: the fine fraction, a tan cloud that hangs low behind the car, grows
 *    and drifts off long after the car has gone.
 * Both scale with how fast the tire churns the surface (ground speed plus slide)
 * and with how loose it is: a gravel trap erupts, grass barely smokes.
 */
export class SurfaceSpray {
  private readonly grains = new ParticlePool(MAX_GRAINS, 'grain', 2)
  private readonly dust = new ParticlePool(MAX_DUST, 'puff', 3)
  private readonly grainDebt: number[] = []
  private readonly dustDebt: number[] = []

  get meshes() {
    return [this.grains.mesh, this.dust.mesh]
  }

  update(wheels: readonly WheelState[], carVelocity: { x: number; y: number; z: number }, dt: number): void {
    const speed = Math.hypot(carVelocity.x, carVelocity.z)
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i]
      const loose = w.grounded ? surfaceProps(w.surface).loose : 0
      const churn = speed + w.slide * 1.5
      if (loose <= 0 || churn < MIN_CHURN) {
        this.grainDebt[i] = this.dustDebt[i] = 0
        continue
      }
      const amount = Math.min(1.5, churn / 22)
      let g = (this.grainDebt[i] ?? 0) + GRAIN_RATE * loose * amount * dt
      while (g >= 1) {
        this.spawnGrain(w, carVelocity, churn)
        g -= 1
      }
      this.grainDebt[i] = g
      let d = (this.dustDebt[i] ?? 0) + DUST_RATE * (0.3 + 0.7 * loose) * amount * dt
      while (d >= 1) {
        this.spawnDust(w, carVelocity, loose, amount)
        d -= 1
      }
      this.dustDebt[i] = d
    }
    this.grains.update(dt)
    this.dust.update(dt, WIND_X, WIND_Z)
  }

  private spawnGrain(w: WheelState, v: { x: number; y: number; z: number }, churn: number): void {
    const c = GRAIN_COLOR[w.surface] ?? GRAIN_COLOR[Surface.Sand]!
    const shade = 0.8 + Math.random() * 0.35
    const spread = w.cfg.width
    _p.x = w.contactPoint.x + (Math.random() - 0.5) * spread
    _p.y = w.contactPoint.y + 0.05
    _p.z = w.contactPoint.z + (Math.random() - 0.5) * spread
    // The tread flicks material up off the back of the contact patch: in the
    // world it keeps a fraction of the car's speed and gets a strong upward kick.
    const carry = 0.15 + Math.random() * 0.35
    const kick = 1.5 + Math.random() * (2 + churn * 0.08)
    _p.vx = v.x * carry + (Math.random() - 0.5) * 2.4
    _p.vy = kick
    _p.vz = v.z * carry + (Math.random() - 0.5) * 2.4
    _p.life = 1.4
    _p.startSize = _p.endSize = 0.04 + Math.random() * 0.09
    _p.alpha = 0.95
    _p.r = c[0] * shade
    _p.g = c[1] * shade
    _p.b = c[2] * shade
    _p.lift = GRAVITY
    _p.drag = 0.35
    this.grains.spawn(_p, w.contactPoint.y + 0.02)
  }

  private spawnDust(w: WheelState, v: { x: number; y: number; z: number }, loose: number, amount: number): void {
    const c = DUST_COLOR[w.surface] ?? DUST_COLOR[Surface.Sand]!
    const shade = 0.9 + Math.random() * 0.15
    _p.x = w.contactPoint.x + (Math.random() - 0.5) * 0.6
    _p.y = w.contactPoint.y + 0.25
    _p.z = w.contactPoint.z + (Math.random() - 0.5) * 0.6
    _p.vx = v.x * 0.25 + (Math.random() - 0.5) * 1.5
    _p.vy = 0.3 + Math.random() * 0.7
    _p.vz = v.z * 0.25 + (Math.random() - 0.5) * 1.5
    _p.life = 3 + Math.random() * 3
    _p.startSize = 0.7 + Math.random() * 0.5
    _p.endSize = (3.5 + Math.random() * 3) * (0.6 + 0.4 * Math.min(1, amount))
    _p.alpha = (0.07 + 0.12 * loose) * Math.min(1, 0.4 + amount)
    _p.r = c[0] * shade
    _p.g = c[1] * shade
    _p.b = c[2] * shade
    _p.lift = 0.12
    _p.drag = 1.1
    this.dust.spawn(_p)
  }

  clear(): void {
    this.grains.clear()
    this.dust.clear()
    this.grainDebt.length = this.dustDebt.length = 0
  }

  dispose(): void {
    this.grains.dispose()
    this.dust.dispose()
  }
}
