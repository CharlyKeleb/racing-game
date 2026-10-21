/**
 * Burnout: brake held, throttle floored, at (near) a standstill. The brakes
 * pin the car while the driven tyres spin up and smoke; let go of the brake
 * and the car launches out of it, the smoke trailing off as it gets going.
 * Pure, fixed-step; VehicleController turns it into wheelspin, slide (which
 * drives smoke, skid marks and squeal) and revs.
 */

/** Pedals needed to hold a burnout. */
export const BURNOUT_THROTTLE = 0.6
export const BURNOUT_BRAKE = 0.5
/** Only from (near) a standstill, m/s. */
export const BURNOUT_MAX_SPEED = 3
/** Spin-up and wind-down times, seconds. */
const RISE_SEC = 0.35
const FALL_SEC = 0.6
/** Exhaust backfires during a hard burnout: one every this many seconds (randomised), each fading this fast. */
const POP_MIN_SEC = 0.12
const POP_MAX_SEC = 0.55
const POP_FADE_SEC = 0.12

export interface BurnoutInput {
  /** Raw pedals, 0..1. */
  throttle: number
  brake: number
  handbrake: boolean
  /** |forward speed|, m/s. */
  speed: number
  /** In a forward gear (or about to be: both pedals at a standstill ask for 1st). */
  forward: boolean
  grounded: boolean
}

export class Burnout {
  /** 0..1: how hard the driven tyres are spinning. */
  intensity = 0
  /** Brakes and throttle both on: the car is pinned while the tyres spin. */
  holding = false
  /** Exhaust backfire flash, 0..1, decaying (drives the exhaust flames). */
  pop = 0
  private nextPop = POP_MIN_SEC
  private seed = 12345

  update(dt: number, s: BurnoutInput): void {
    const pedals = s.throttle >= BURNOUT_THROTTLE && s.brake >= BURNOUT_BRAKE && !s.handbrake && s.forward && s.grounded
    // Start only from a standstill; once going, a held burnout keeps it pinned.
    this.holding = pedals && (this.holding || s.speed < BURNOUT_MAX_SPEED)
    if (this.holding) {
      this.intensity = Math.min(1, this.intensity + dt / RISE_SEC)
    } else {
      // Launched out of it (or let go): the spin winds down, faster without throttle.
      const fall = s.throttle >= BURNOUT_THROTTLE && s.grounded ? FALL_SEC : FALL_SEC / 2
      this.intensity = Math.max(0, this.intensity - dt / fall)
    }
    // Backfires: irregular flashes at the tailpipes while it's really going.
    this.pop = Math.max(0, this.pop - dt / POP_FADE_SEC)
    if (this.intensity > 0.6 && s.throttle >= BURNOUT_THROTTLE && (this.nextPop -= dt) <= 0) {
      this.pop = 0.6 + 0.4 * this.random()
      this.nextPop = POP_MIN_SEC + (POP_MAX_SEC - POP_MIN_SEC) * this.random()
    }
  }

  /** Small deterministic LCG: same pops for the same inputs, no allocation. */
  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647
    return this.seed / 2147483647
  }

  reset(): void {
    this.intensity = 0
    this.holding = false
    this.pop = 0
    this.nextPop = POP_MIN_SEC
  }
}
