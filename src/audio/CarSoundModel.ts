/**
 * What the car should sound like this frame, beyond the engine itself: turbo
 * spool, overrun crackle, and one-shot events (blow-off, gear shifts, lift-off
 * burble, nitro). Pure — numbers in, numbers out — so it's unit tested and the
 * Web Audio side (CarSound) only maps these to nodes.
 */

export interface CarSoundInput {
  rpm: number
  /** 0..1 */
  throttle: number
  /** -1 reverse, 0 neutral, 1..n */
  gear: number
  nitroActive: boolean
  nitroPerfect: boolean
}

/** Rpm where overrun starts to crackle, and where it's at full strength. */
const CRACKLE_RPM = 3500
const CRACKLE_FULL_RPM = 7000
/** Overrun crackle fades over this long after a lift, seconds. */
const CRACKLE_DECAY = 1.1
/** Rpm the turbos come on boost, and full boost. */
const SPOOL_RPM = 2200
const SPOOL_FULL_RPM = 4500
/** Turbo spool lag up / bleed down, seconds. */
const SPOOL_UP = 0.55
const SPOOL_DOWN = 0.18
/** Lift-off burble: minimum rpm and cooldown. */
const BURBLE_RPM = 4200
const BURBLE_COOLDOWN = 2
const LIFTED = 0.15
const ON_THROTTLE = 0.55

export class CarSoundModel {
  /** Turbo boost, 0..1: whistle and intake whoosh. */
  spool = 0
  /** Overrun crackle strength, 0..1. */
  crackle = 0
  // One-shot events, true (or > 0) for the single update they happen in.
  /** Blow-off valve strength, 0..1 (0 = none). */
  blowOff = 0
  shiftUp = false
  shiftDown = false
  /** Exhaust burble on lifting off high in the revs. */
  liftOff = false
  nitroStart = false
  perfectStart = false

  private prevThrottle = 0
  private prevGear = 1
  private prevNitro = false
  private prevPerfect = false
  private burbleCooldown = 0

  update(i: CarSoundInput, dt: number): void {
    const lifted = this.prevThrottle >= ON_THROTTLE && i.throttle < LIFTED
    const rpmT = (i.rpm - CRACKLE_RPM) / (CRACKLE_FULL_RPM - CRACKLE_RPM)

    // Turbos build boost under load with lag, and bleed it when you lift.
    const boostRpm = Math.min(1, Math.max(0, (i.rpm - SPOOL_RPM) / (SPOOL_FULL_RPM - SPOOL_RPM)))
    const target = i.throttle * boostRpm
    const tau = target > this.spool ? SPOOL_UP : SPOOL_DOWN
    const spoolBefore = this.spool
    this.spool += (target - this.spool) * (1 - Math.exp(-dt / tau))
    this.blowOff = lifted && spoolBefore > 0.4 ? spoolBefore : 0

    // Overrun: unburnt fuel popping in the hot exhaust after a lift.
    if (i.throttle > LIFTED) {
      this.crackle = Math.max(0, this.crackle - dt * 6)
    } else {
      if (lifted && rpmT > 0) this.crackle = Math.max(this.crackle, Math.min(1, 0.45 + 0.55 * rpmT))
      this.crackle *= Math.exp(-dt / CRACKLE_DECAY)
      // Engine braking high in the revs keeps a light crackle going.
      if (rpmT > 0.3) this.crackle = Math.max(this.crackle, 0.2 * rpmT)
    }

    this.burbleCooldown = Math.max(0, this.burbleCooldown - dt)
    this.liftOff = lifted && i.rpm > BURBLE_RPM && this.burbleCooldown === 0
    if (this.liftOff) this.burbleCooldown = BURBLE_COOLDOWN

    this.shiftUp = i.gear > this.prevGear && this.prevGear > 0
    this.shiftDown = i.gear < this.prevGear && i.gear > 0

    this.nitroStart = i.nitroActive && !this.prevNitro
    this.perfectStart = i.nitroPerfect && !this.prevPerfect

    this.prevThrottle = i.throttle
    this.prevGear = i.gear
    this.prevNitro = i.nitroActive
    this.prevPerfect = i.nitroPerfect
  }

  reset(): void {
    this.spool = this.crackle = this.blowOff = this.burbleCooldown = 0
    this.shiftUp = this.shiftDown = this.liftOff = this.nitroStart = this.perfectStart = false
    this.prevThrottle = 0
    this.prevGear = 1
    this.prevNitro = this.prevPerfect = false
  }
}
