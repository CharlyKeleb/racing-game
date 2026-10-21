/**
 * Exhaust pops and bangs, supercar style. Unburnt fuel lights in the hot
 * exhaust when the throttle snaps shut at high revs (a crackling burst on the
 * overrun), on a hard upshift (one big "POOO"), as nitro lights, and through a
 * burnout. Pure and fixed-step, with its own deterministic random stream: it
 * says when a pop happens and how big; Game turns that into sound, and the
 * exhaust effect into a fireball.
 */

export const NONE = 0
export const CRACKLE = 1
export const BANG = 2
export type PopKind = typeof NONE | typeof CRACKLE | typeof BANG

export interface BackfireInput {
  /** Raw throttle pedal, 0..1. */
  throttle: number
  /** Engine speed as a share of redline, 0..1. */
  revs: number
  /** Current gear (−1 reverse, 0 neutral, 1..n). */
  gear: number
  /** Burnout intensity, 0..1 (Burnout.intensity). */
  burnout: number
  /** Nitro lit this tick. */
  nitroLit: boolean
}

/** Lift-off counts as a snap shut if the pedal fell from above this… */
const LIFT_FROM = 0.7
/** …to below this, within LIFT_WINDOW seconds. */
const LIFT_TO = 0.15
const LIFT_WINDOW = 0.3
/** Overrun crackle only when the engine is really spinning. */
const OVERRUN_REVS = 0.55
/** A hard upshift bangs from this far up the rev range, with the throttle down. */
const UPSHIFT_REVS = 0.8
/** Never two pops closer than this, seconds. */
const MIN_GAP = 0.05
/** How long a fireball lasts on screen, seconds. */
const CRACKLE_SEC = 0.11
const BANG_SEC = 0.17

export class Backfire {
  /** The pop that fired this tick (for its sound), NONE otherwise. */
  popped: PopKind = NONE
  /** 0..1 strength of that pop. */
  strength = 0
  /** Fireball on screen: 1 when a pop fires, falling to 0 over its life. */
  flash = 0
  /** Kind of the fireball on screen (bangs are bigger and hotter). */
  flashKind: PopKind = NONE
  /** Count of pops so far, so the effect can vary each fireball. */
  count = 0
  private sinceHigh = Infinity
  private burst = 0
  private nextBurst = 0
  private sincePop = Infinity
  private lastGear = 1
  private burnoutNext = 0.12
  private seed = 2463534242

  update(dt: number, s: BackfireInput): void {
    this.popped = NONE
    this.sincePop += dt
    const life = this.flashKind === BANG ? BANG_SEC : CRACKLE_SEC
    this.flash = Math.max(0, this.flash - dt / life)

    // Overrun: the throttle snapped shut at high revs → a burst of 2–5 crackles,
    // sometimes opening with a bang (the Lamborghini "POOO" on lift).
    this.sinceHigh = s.throttle >= LIFT_FROM ? 0 : this.sinceHigh + dt
    if (s.throttle <= LIFT_TO && this.sinceHigh <= LIFT_WINDOW && s.revs >= OVERRUN_REVS && s.gear > 0 && this.burst === 0) {
      this.sinceHigh = Infinity
      this.burst = 2 + Math.floor(this.random() * 4)
      this.nextBurst = 0.02 + 0.05 * this.random()
      if (this.random() < 0.35) this.fire(BANG, 0.7 + 0.3 * this.random())
    }
    if (this.burst > 0) {
      if (s.throttle > 0.5) this.burst = 0 // back on the power: the crackle stops
      else if ((this.nextBurst -= dt) <= 0) {
        this.fire(CRACKLE, (0.55 + 0.45 * this.random()) * Math.min(1, s.revs / OVERRUN_REVS))
        this.burst--
        this.nextBurst = 0.06 + 0.1 * this.random()
      }
    }

    // A hard upshift: one big bang as the ignition cuts for the shift.
    if (s.gear > this.lastGear && this.lastGear > 0 && s.throttle >= LIFT_FROM && s.revs >= UPSHIFT_REVS * 0.85 && this.random() < 0.75) {
      this.fire(BANG, 0.75 + 0.25 * this.random())
    }
    this.lastGear = s.gear

    // Nitro lighting up: a bang with the flame.
    if (s.nitroLit) this.fire(BANG, 1)

    // Burnout: irregular pops and the odd bang while it's really going.
    if (s.burnout > 0.6 && s.throttle >= 0.6 && (this.burnoutNext -= dt) <= 0) {
      this.fire(this.random() < 0.3 ? BANG : CRACKLE, 0.6 + 0.4 * this.random())
      this.burnoutNext = 0.12 + 0.43 * this.random()
    }
  }

  private fire(kind: PopKind, strength: number): void {
    // Too soon after the last pop, unless it upgrades a crackle to a bang on the same tick.
    if (this.sincePop < MIN_GAP && !(this.sincePop === 0 && kind > this.popped)) return
    this.popped = kind
    this.strength = strength
    this.flash = 1
    this.flashKind = kind
    this.sincePop = 0
    this.count++
  }

  /** Xorshift: same pops for the same inputs, no allocation. */
  private random(): number {
    let x = this.seed
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5
    this.seed = x >>> 0
    return this.seed / 4294967296
  }

  reset(): void {
    this.popped = this.flashKind = NONE
    this.strength = this.flash = 0
    this.sinceHigh = this.sincePop = Infinity
    this.burst = 0
    this.lastGear = 1
    this.burnoutNext = 0.12
  }
}
