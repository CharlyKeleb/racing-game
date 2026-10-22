import type { QualityPreset } from '../stores/gameStore'
import { EFFECT_BUDGET } from './EffectBudget'
import { surfaceProps } from '../vehicles/Surface'
import type { WheelState } from '../vehicles/VehicleController'
import { createParticles, particleBudget, type ParticleSpawn } from './Particles'

const MAX_PARTICLES = 640
/**
 * Sliding speed (m/s) where smoke starts and where it's at full density. Real
 * tires only smoke when the patch is actually skidding — a slide, a locked
 * wheel, a burnout — not in grippy cornering or ABS braking.
 */
const SLIDE_START = 2.5
const SLIDE_FULL = 12
/** Puffs per second per wheel at full density. */
const EMIT_RATE = 40
const LIFE_MIN = 2.4
const LIFE_MAX = 4.4
/** Light breeze the cloud drifts off on, m/s. */
const WIND_X = 0.5
const WIND_Z = 0.25

const _p: ParticleSpawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, startSize: 1, endSize: 1, alpha: 1, r: 1, g: 1, b: 1, lift: 0, drag: 0 }

/**
 * Rubber smoke from skidding tires on tarmac. It's made at the road surface,
 * so it starts low and nearly still in the world (only a little of the car's
 * speed carries into it), spreads wide and thin, rolls up slowly as the hot
 * air rises and drifts off on the breeze. Dense, bright clouds only come from
 * a hard, sustained slide; a brief skid leaves a thin grey wisp.
 */
export class TireSmoke {
  private readonly pool = createParticles(MAX_PARTICLES, 'puff', 3)
  /**
   * GPU particles (#51): `budget` times the puffs, each fainter, living half
   * as long again and growing a little bigger, so a drift leaves a thick
   * cloud that billows and lingers rather than a trail of separate sprites.
   */
  private readonly budget = particleBudget()
  private readonly rate = EMIT_RATE * this.budget
  private readonly alphaScale = Math.pow(this.budget, -0.55)
  private readonly lifeScale = this.budget > 1 ? 1.5 : 1
  private readonly sizeScale = this.budget > 1 ? 1.25 : 1
  private emission = 1
  private burnout = 0
  private throwX = 0
  private throwZ = 0
  private cloudSize = 1
  private readonly emitDebt: number[] = []

  setQuality(quality: QualityPreset): void {
    const budget = EFFECT_BUDGET[quality]
    this.pool.setLimit(budget.smoke)
    this.emission = budget.emission
    this.cloudSize = budget.cloudSize
  }

  get mesh() {
    return this.pool.mesh
  }

  /**
   * @param carVelocity chassis velocity, m/s.
   * @param burnout 0..1: a standing burnout pours out a bigger, longer-lived
   *   cloud, thrown back off the spinning tread, that builds up around the car.
   * @param forward the car's forward axis (for which way the tread throws the smoke).
   */
  update(wheels: readonly WheelState[], carVelocity: { x: number; y: number; z: number }, dt: number, burnout = 0, forward?: { x: number; z: number }): void {
    this.burnout = burnout
    this.throwX = forward ? -forward.x : 0
    this.throwZ = forward ? -forward.z : 0
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i]
      // Loose ground throws dust instead (SurfaceSpray); rubber smokes on tarmac.
      const k = w.grounded && surfaceProps(w.surface).loose === 0 ? Math.min(1, (w.slide - SLIDE_START) / (SLIDE_FULL - SLIDE_START)) : 0
      if (k <= 0) {
        this.emitDebt[i] = 0
        continue
      }
      let debt = (this.emitDebt[i] ?? 0) + this.rate * (0.25 + 0.75 * k) * (1 + 0.3 * burnout) * Math.min(dt, .05) * this.emission
      while (debt >= 1) {
        this.spawn(w, carVelocity, k)
        debt -= 1
      }
      this.emitDebt[i] = debt
    }
    this.pool.update(dt, WIND_X, WIND_Z)
  }

  private spawn(w: WheelState, carVel: { x: number; y: number; z: number }, k: number): void {
    const spread = w.cfg.width
    const shade = 0.84 + Math.random() * 0.08
    // In a burnout the smoke is born just behind the tread, so the spinning tyre itself still shows.
    const behind = this.burnout * (0.45 + 0.35 * Math.random())
    _p.x = w.contactPoint.x + (Math.random() - 0.5) * spread + this.throwX * behind
    _p.y = w.contactPoint.y + 0.12
    _p.z = w.contactPoint.z + (Math.random() - 0.5) * spread + this.throwZ * behind
    // In a burnout the tread flings the smoke back and out from under the car.
    const b = this.burnout, fling = b * (1.5 + 2 * Math.random())
    _p.vx = carVel.x * 0.3 + (Math.random() - 0.5) * (1.6 + 2 * b) + this.throwX * fling
    _p.vy = 0.15 + Math.random() * 0.45
    _p.vz = carVel.z * 0.3 + (Math.random() - 0.5) * (1.6 + 2 * b) + this.throwZ * fling
    _p.life = (LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN)) * this.lifeScale * (1 + 0.45 * b)
    _p.startSize = 0.5 + 0.35 * Math.random()
    _p.endSize = (3 + 2.2 * Math.random()) * (0.55 + 0.45 * k) * this.sizeScale * this.cloudSize * (1 + 0.45 * b)
    _p.alpha = (0.05 + 0.13 * k) * this.alphaScale
    // Faintly blue-grey, like vaporised rubber, not pure white.
    _p.r = shade
    _p.g = shade + 0.01
    _p.b = shade + 0.035
    _p.lift = 0.35
    _p.drag = 1.3
    this.pool.spawn(_p)
  }

  clear(): void {
    this.pool.clear()
    for (let i = 0; i < this.emitDebt.length; i++) this.emitDebt[i] = 0
  }

  dispose(): void {
    this.pool.dispose()
  }
}
