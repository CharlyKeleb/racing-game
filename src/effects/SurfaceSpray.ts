import type { QualityPreset } from '../stores/gameStore'
import { EFFECT_BUDGET } from './EffectBudget'
import { Surface, surfaceProps } from '../vehicles/Surface'
import type { WheelState } from '../vehicles/VehicleController'
import { ParticlePool, type ParticleSpawn } from './Particles'

const MAX_GRAINS = 1500
const MAX_SHEET = 500
const MAX_DUST = 720
/** Below this ground speed (m/s) a tire doesn't throw anything. */
const MIN_CHURN = 2
/** Grains / sand-sheet puffs / dust puffs per second per wheel at full churn on the loosest surface. */
const GRAIN_RATE = 230
const SHEET_RATE = 60
const DUST_RATE = 26
/** Rear tyres dig and throw; fronts mostly push the surface aside. */
const REAR_SCALE = 1.5
const FRONT_SCALE = 0.55
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
  [Surface.Sand]: [0.68, 0.58, 0.42],
  [Surface.Gravel]: [0.66, 0.63, 0.58],
  [Surface.Grass]: [0.52, 0.47, 0.36],
  [Surface.None]: [0.52, 0.47, 0.36],
}

const _dir = { x: 0, z: 0 }
const _p: ParticleSpawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, startSize: 1, endSize: 1, alpha: 1, r: 1, g: 1, b: 1, lift: 0, drag: 0 }

/**
 * What a tire throws up off the tarmac. Three layers, like the real thing:
 *  - grains: sand / gravel (or soil clods on grass) flicked up and back off the
 *    tread in ballistic arcs that fall and settle;
 *  - sheet: the bulk of a rooster tail — dense, heavy sprays of sand thrown up
 *    behind the rear tyres that collapse back down within a second;
 *  - dust: the fine fraction, a tan plume dragged along in the car's wake that
 *    billows, hangs and drifts off long after the car has gone.
 * All scale with how fast the tire churns the surface (ground speed plus slide)
 * and how loose it is: a gravel trap erupts, grass barely smokes. The rears
 * throw far more than the fronts.
 */
export class SurfaceSpray {
  // The chase camera sits ~5 m behind the car, right where the spray lands:
  // grains and the sand sheet may come close to the lens; the dust cloud fades
  // a little earlier so ploughing through it never whites out the screen.
  private readonly grains = new ParticlePool(MAX_GRAINS, 'grain', 2, [0.8, 2])
  private readonly sheet = new ParticlePool(MAX_SHEET, 'spray', 2, [0.5, 1.6])
  private readonly dust = new ParticlePool(MAX_DUST, 'puff', 3, [1.5, 4])
  private emission = 1
  private readonly grainDebt: number[] = []
  private readonly sheetDebt: number[] = []
  private readonly dustDebt: number[] = []

  setQuality(quality: QualityPreset): void {
    const budget = EFFECT_BUDGET[quality]
    this.grains.setLimit(budget.grains)
    this.sheet.setLimit(budget.sheet)
    this.dust.setLimit(budget.dust)
    this.emission = budget.emission
  }

  get meshes() {
    return [this.grains.mesh, this.sheet.mesh, this.dust.mesh]
  }

  update(wheels: readonly WheelState[], carVelocity: { x: number; y: number; z: number }, dt: number): void {
    const emissionDt = Math.min(dt, .05) * this.emission
    const speed = Math.hypot(carVelocity.x, carVelocity.z)
    // Direction of travel on the ground: material is thrown back along it.
    _dir.x = speed > 0.1 ? carVelocity.x / speed : 0
    _dir.z = speed > 0.1 ? carVelocity.z / speed : 0
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i]
      const loose = w.grounded ? surfaceProps(w.surface).loose : 0
      const churn = speed + w.slide * 1.5
      if (loose <= 0 || churn < MIN_CHURN) {
        this.grainDebt[i] = this.sheetDebt[i] = this.dustDebt[i] = 0
        continue
      }
      const amount = Math.min(1.5, churn / 22)
      const axle = w.cfg.position[2] < 0 ? REAR_SCALE : FRONT_SCALE
      let g = (this.grainDebt[i] ?? 0) + GRAIN_RATE * loose * amount * axle * emissionDt
      while (g >= 1) {
        this.spawnGrain(w, carVelocity, churn)
        g -= 1
      }
      this.grainDebt[i] = g
      let sh = (this.sheetDebt[i] ?? 0) + SHEET_RATE * loose * loose * amount * axle * emissionDt
      while (sh >= 1) {
        this.spawnSheet(w, carVelocity, churn, amount)
        sh -= 1
      }
      this.sheetDebt[i] = sh
      let d = (this.dustDebt[i] ?? 0) + DUST_RATE * (0.3 + 0.7 * loose) * amount * axle * emissionDt
      while (d >= 1) {
        this.spawnDust(w, carVelocity, loose, amount)
        d -= 1
      }
      this.dustDebt[i] = d
    }
    this.grains.update(dt)
    this.sheet.update(dt)
    this.dust.update(dt, WIND_X, WIND_Z)
  }

  private spawnGrain(w: WheelState, v: { x: number; y: number; z: number }, churn: number): void {
    const c = GRAIN_COLOR[w.surface] ?? GRAIN_COLOR[Surface.Sand]!
    // Grains are seen mostly in silhouette against bright sky: keep them darker
    // than the dust, or they read as sparks.
    const shade = 0.55 + Math.random() * 0.35
    const spread = w.cfg.width
    _p.x = w.contactPoint.x + (Math.random() - 0.5) * spread
    _p.y = w.contactPoint.y + 0.05
    _p.z = w.contactPoint.z + (Math.random() - 0.5) * spread
    // The tread flicks material up off the back of the contact patch: in the
    // world it keeps a fraction of the car's speed and gets a strong upward kick.
    const carry = 0.05 + Math.random() * 0.3
    const kick = 2 + Math.random() * (2.5 + churn * 0.07)
    const back = 0.5 + Math.random() * (1 + churn * 0.06)
    _p.vx = v.x * carry - _dir.x * back + (Math.random() - 0.5) * 2.6
    _p.vy = kick
    _p.vz = v.z * carry - _dir.z * back + (Math.random() - 0.5) * 2.6
    _p.life = 1.3
    // Mostly grains, the odd clump.
    _p.startSize = _p.endSize = Math.random() < 0.1 ? 0.12 + Math.random() * 0.08 : 0.04 + Math.random() * 0.08
    _p.alpha = 1
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
    // Starts just behind the tyre, already moving with the car's wake.
    _p.x = w.contactPoint.x - _dir.x * 0.6 + (Math.random() - 0.5) * 0.8
    _p.y = w.contactPoint.y + 0.3 + Math.random() * 0.3
    _p.z = w.contactPoint.z - _dir.z * 0.6 + (Math.random() - 0.5) * 0.8
    const wake = 0.35 + Math.random() * 0.25
    _p.vx = v.x * wake + (Math.random() - 0.5) * 2
    _p.vy = 0.6 + Math.random() * 1.2
    _p.vz = v.z * wake + (Math.random() - 0.5) * 2
    _p.life = 3 + Math.random() * 2.5
    // Born big and faint so neighbours merge into one plume instead of discs.
    _p.startSize = 1.4 + Math.random() * 0.8
    _p.endSize = (4.5 + Math.random() * 4) * (0.6 + 0.4 * Math.min(1, amount))
    _p.alpha = (0.045 + 0.1 * loose) * Math.min(1, 0.35 + amount)
    _p.r = c[0] * shade
    _p.g = c[1] * shade
    _p.b = c[2] * shade
    _p.lift = 0.18
    _p.drag = 1.2
    this.dust.spawn(_p)
  }

  /** Rooster-tail sheet: a dense spray of sand thrown up behind the tyre that collapses back. */
  private spawnSheet(w: WheelState, v: { x: number; y: number; z: number }, churn: number, amount: number): void {
    const c = GRAIN_COLOR[w.surface] ?? GRAIN_COLOR[Surface.Sand]!
    const shade = 0.7 + Math.random() * 0.25
    _p.x = w.contactPoint.x - _dir.x * 0.4 + (Math.random() - 0.5) * w.cfg.width
    _p.y = w.contactPoint.y + 0.15
    _p.z = w.contactPoint.z - _dir.z * 0.4 + (Math.random() - 0.5) * w.cfg.width
    const back = 1 + Math.random() * (1.5 + churn * 0.05)
    const carry = 0.15 + Math.random() * 0.25
    _p.vx = v.x * carry - _dir.x * back + (Math.random() - 0.5) * 1.6
    _p.vy = 2.5 + Math.random() * (2 + churn * 0.05)
    _p.vz = v.z * carry - _dir.z * back + (Math.random() - 0.5) * 1.6
    _p.life = 0.7 + Math.random() * 0.4
    // Each sprite is a scatter of grains (the 'spray' look) that spreads as it flies.
    _p.startSize = 0.25 + Math.random() * 0.2
    _p.endSize = (0.7 + Math.random() * 0.6) * (0.6 + 0.4 * Math.min(1, amount))
    _p.alpha = 0.85
    _p.r = c[0] * shade
    _p.g = c[1] * shade
    _p.b = c[2] * shade
    _p.lift = -7
    _p.drag = 0.8
    this.sheet.spawn(_p, w.contactPoint.y + 0.05)
  }

  clear(): void {
    this.grains.clear()
    this.sheet.clear()
    this.dust.clear()
    this.grainDebt.length = this.sheetDebt.length = this.dustDebt.length = 0
  }

  dispose(): void {
    this.grains.dispose()
    this.sheet.dispose()
    this.dust.dispose()
  }
}
