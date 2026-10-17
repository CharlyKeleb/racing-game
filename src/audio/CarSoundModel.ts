/**
 * What the car should sound like this frame: the engine as heard (rev inertia,
 * PDK-style shift dynamics, smoothed pedal), turbo spool, overrun crackle and
 * one-shot events (blow-off, gear shifts, lift-off burble, nitro). Pure —
 * numbers in, numbers out — so it's unit tested and the Web Audio side
 * (CarSound) only maps these to nodes.
 *
 * Why an "audible" rpm separate from the physics rpm: the drivetrain changes
 * gear in a single 16 ms tick, so its rpm drops ~2500 on an upshift and jumps
 * ~1500 on a downshift instantly, and a keyboard throttle is on/off. Played
 * straight that's a stepped, synthetic note. A real 911's PDK cuts ignition
 * and lets the revs fall over ~0.1 s on an upshift, and blips the throttle to
 * rev-match a downshift — the "bwaap… bwaap" under braking.
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

/** Pedal as heard: how fast the engine note follows the throttle on / off, seconds. */
const PEDAL_ATTACK = 0.06
const PEDAL_RELEASE = 0.11
/** Rev inertia between shifts: max rise (rpm/s, more with throttle) and fall. */
const REV_UP = 6000
const REV_UP_THROTTLE = 9000
const REV_DOWN = 7500
/** How tightly the heard rpm follows the physics rpm in gear, seconds. */
const FOLLOW = 0.03
/** Upshift: ignition cut length and the glide down to the new gear's revs. */
const CUT_TIME = 0.07
const UPSHIFT_GLIDE = 0.035
/** Downshift: rev-match blip length, overshoot above the new revs, glide up — a PDK snaps it. */
const BLIP_TIME = 0.15
const BLIP_OVERSHOOT = 0.06
const DOWNSHIFT_GLIDE = 0.02
/** A shift's glide lasts this long before normal rev inertia takes over again. */
const GLIDE_TIME = 0.16
const DOWNSHIFT_GLIDE_TIME = 0.11

export class CarSoundModel {
  /** Engine rpm as heard (drives the recorded engine's pitch). */
  rpm = 0
  /** Throttle as heard, 0..1: smoothed pedal, cut on upshifts, blipped on downshifts. */
  load = 0
  /** Upshift ignition cut, 0..1: the engine note dips while it's on. */
  cut = 0
  /** Downshift rev-match blip, 0..1: a short burst of throttle and exhaust. */
  blip = 0
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
  private pedal = 0
  private cutLeft = 0
  private blipLeft = 0
  private glideLeft = 0
  private glideTau = UPSHIFT_GLIDE
  private started = false

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
    this.updateEngine(i, dt)

    this.nitroStart = i.nitroActive && !this.prevNitro
    this.perfectStart = i.nitroPerfect && !this.prevPerfect

    this.prevThrottle = i.throttle
    this.prevGear = i.gear
    this.prevNitro = i.nitroActive
    this.prevPerfect = i.nitroPerfect
  }

  /** Heard rpm and load: rev inertia, upshift cut + glide, downshift blip + overshoot. */
  private updateEngine(i: CarSoundInput, dt: number): void {
    if (!this.started) {
      this.rpm = i.rpm
      this.started = true
    }
    const k = (tau: number) => 1 - Math.exp(-dt / tau)

    this.pedal += (i.throttle - this.pedal) * k(i.throttle > this.pedal ? PEDAL_ATTACK : PEDAL_RELEASE)

    if (this.shiftUp) {
      this.cutLeft = CUT_TIME
      this.glideLeft = GLIDE_TIME
      this.glideTau = UPSHIFT_GLIDE
    }
    if (this.shiftDown) {
      this.blipLeft = BLIP_TIME
      this.glideLeft = DOWNSHIFT_GLIDE_TIME
      this.glideTau = DOWNSHIFT_GLIDE
    }

    // Envelopes: the cut snaps in and eases out; the blip punches then decays.
    this.cut += ((this.cutLeft > 0 ? 1 : 0) - this.cut) * k(this.cutLeft > 0 ? 0.012 : 0.04)
    const blipOn = this.blipLeft > BLIP_TIME * 0.45
    this.blip += ((blipOn ? 1 : 0) - this.blip) * k(blipOn ? 0.008 : 0.05)

    // Rev-match overshoot: aim a little above the new gear's revs, settling back.
    const overshoot = this.blipLeft > 0 ? BLIP_OVERSHOOT * (this.blipLeft / BLIP_TIME) : 0
    const target = Math.max(0, i.rpm * (1 + overshoot))
    if (this.glideLeft > 0) {
      this.rpm += (target - this.rpm) * k(this.glideTau)
    } else {
      const step = (target - this.rpm) * k(FOLLOW)
      const up = (REV_UP + REV_UP_THROTTLE * this.pedal) * dt
      this.rpm += Math.min(up, Math.max(-REV_DOWN * dt, step))
    }

    this.load = Math.max(this.pedal * (1 - 0.85 * this.cut), 0.9 * this.blip)
    this.cutLeft = Math.max(0, this.cutLeft - dt)
    this.blipLeft = Math.max(0, this.blipLeft - dt)
    this.glideLeft = Math.max(0, this.glideLeft - dt)
  }

  reset(): void {
    this.rpm = this.load = this.cut = this.blip = this.pedal = 0
    this.cutLeft = this.blipLeft = this.glideLeft = 0
    this.started = false
    this.spool = this.crackle = this.blowOff = this.burbleCooldown = 0
    this.shiftUp = this.shiftDown = this.liftOff = this.nitroStart = this.perfectStart = false
    this.prevThrottle = 0
    this.prevGear = 1
    this.prevNitro = this.prevPerfect = false
  }
}
