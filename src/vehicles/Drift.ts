/**
 * Drift state machine and guidance (NFS / Asphalt-style). Pure — numbers in,
 * numbers out — so it's unit tested and VehicleController only maps it onto
 * the car: `amount` scales tire grip and the stability assist, `guide()` gives
 * the drift angle and path the controller steers the car along.
 *
 * Arcade drifting, not a tire-physics slide: once in, the car settles at a
 * big, stable body angle and carves a smooth arc while keeping its speed.
 * Steering INTO the drift deepens the angle and tightens the arc; easing off
 * or countersteering opens it out; straightening up (or countersteering for a
 * while) ends it.
 *
 * A planted car shouldn't slide just because you turn, so a drift needs an
 * entry: a quick brake TAP while turning (Asphalt's drift), or the handbrake
 * (Space / the touch Drift button). A tap is short — braking into a corner
 * (held longer) doesn't start a drift.
 * `autoEntries` adds the real techniques, which fire on their own:
 *  - fast turn-in: hard lock at high speed on the throttle (weight off the rear)
 *  - brake-tap (feint): brake, release, turn in hard — the classic NFS entry
 *  - downshift + turn: engine braking on the rears as you turn in (clutch-kick)
 * They're off because a keyboard's steering is all-or-nothing, so normal
 * driving (brake, downshift, turn in at full lock) met them at nearly every
 * corner and the car kept drifting when nobody asked it to.
 * Once sideways the rears give up grip (more with throttle, so the gas pedal
 * sets the angle), and the drift ends when the driver straightens up, slows
 * right down, or holds the brake.
 */

export interface DriftConfig {
  /**
   * Also start drifts from fast turn-in, brake-tap and downshift entries, not
   * just the handbrake. Off by default: see the class comment.
   */
  autoEntries: boolean
  /** No drifts below this forward speed, m/s. */
  minSpeed: number
  /** Fast turn-in entry: speed (m/s) and steering lock needed on the throttle. */
  fastSpeed: number
  /** Lock needed for any entry, 0..1 (fast turn-in uses `fastLock`). */
  entryLock: number
  fastLock: number
  /** Brake-tap / downshift entries stay armed this long, seconds. */
  armTime: number
  /** Rear lateral grip in a drift, and how much full throttle takes off it. */
  rearGrip: number
  throttleGripLoss: number
  /** Yaw rate (rad/s) given on entry, toward the turn, to swing the tail out. */
  kick: number
  /** Ease in / out, seconds. */
  attack: number
  release: number
  /** Drift ends after the wheel's been near straight this long, seconds. */
  exitTime: number
  /** Below this body slip angle (rad) hard braking ends a drift. */
  exitAngle: number
  /** Brake tap entry: a press no longer than this (s), released while (or just before) steering. */
  tapMaxSec: number
  /** Body angle to the direction of travel, radians: centred steering, full lock into the drift, full countersteer. */
  baseAngle: number
  holdAngle: number
  minAngle: number
  /** Sideways acceleration of the drift's arc, in g: centred steering; extra at full lock into it; less at full countersteer. */
  pathG: number
  pathGain: number
  pathCounter: number
  /** Countersteering this long (s) ends the drift. */
  counterExitTime: number
  /** Speed lost per second while drifting (fraction): drifts keep their speed. */
  scrub: number
  /** How much of the tires' sideways grip the drift takes over (0..1). */
  lateralRelief: number
  /** How quickly the body swings to the target angle (1/s) and the yaw rate settles (1/s). */
  angleGain: number
  yawResponse: number
}

export const DEFAULT_DRIFT: DriftConfig = {
  autoEntries: false,
  minSpeed: 15,
  fastSpeed: 42,
  entryLock: 0.6,
  fastLock: 0.85,
  armTime: 0.6,
  rearGrip: 0.6,
  throttleGripLoss: 0.14,
  kick: 0.75,
  attack: 0.12,
  release: 0.25,
  exitTime: 0.3,
  exitAngle: 0.1,
  tapMaxSec: 0.25,
  baseAngle: 0.38,
  holdAngle: 0.62,
  minAngle: 0.15,
  pathG: 0.55,
  pathGain: 0.85,
  pathCounter: 0.5,
  counterExitTime: 0.7,
  scrub: 0.05,
  lateralRelief: 0.8,
  angleGain: 4,
  yawResponse: 9,
}

/** What the drift wants this tick. Angles and rates are signed about +Y (counter-clockwise from above). */
export interface DriftGuide {
  /** Target body angle relative to the direction of travel, radians. */
  angle: number
  /** Target turn rate of the direction of travel, rad/s. */
  pathRate: number
}

export interface DriftInput {
  /** Forward speed, m/s (absolute). */
  speed: number
  /** -1 left .. 1 right */
  steer: number
  throttle: number
  brake: number
  handbrake: boolean
  /** Body slip angle, radians (absolute). */
  slipAngle: number
  /** True on the tick the gearbox shifted down. */
  downshift: boolean
  /** Disable brake-tap drift entry for normal keyboard cornering. Handbrake is unaffected. */
  allowBrakeTap?: boolean
}

export class Drift {
  /** 0..1: how much drift handling is applied right now (eased). */
  amount = 0
  /** True while a drift is under way (entered, not yet ended). */
  active = false
  /** Set for the single tick a drift starts: -1 into a left turn, 1 right, 0 none. */
  entry = 0
  /** Which way the current drift turns: -1 left, 1 right (kept after it ends). */
  direction = 0
  /** Drift points of the drift under way: speed × angle × time. */
  score = 0
  /** Points of the last finished drift, and seconds since it finished (for the HUD). */
  lastScore = 0
  sinceEnd = Infinity

  private brakeHeld = 0
  private steeredWhileBraking = false
  private tapArm = 0
  private counter = 0

  private brakeArm = 0
  private downshiftArm = 0
  private wasBraking = false
  private calm = 0

  update(i: DriftInput, cfg: DriftConfig, dt: number): void {
    this.entry = 0
    // Arm the brake-tap entry when the brake is released, the downshift entry when it happens.
    const braking = i.brake > 0.4
    if (this.wasBraking && !braking) {
      this.brakeArm = cfg.armTime
      // A short press made while already turning is a drift tap. A longer one,
      // or braking in a straight line before turning in, is just braking.
      if (i.allowBrakeTap !== false && this.brakeHeld <= cfg.tapMaxSec && this.steeredWhileBraking) this.tapArm = cfg.armTime
    }
    this.brakeHeld = braking ? this.brakeHeld + dt : 0
    this.steeredWhileBraking = braking && (this.steeredWhileBraking || Math.abs(i.steer) >= cfg.entryLock)
    this.tapArm = i.allowBrakeTap === false ? 0 : Math.max(0, this.tapArm - dt)
    this.wasBraking = braking
    if (i.downshift && i.throttle < 0.3) this.downshiftArm = cfg.armTime
    this.brakeArm = Math.max(0, this.brakeArm - dt)
    this.downshiftArm = Math.max(0, this.downshiftArm - dt)

    const lock = Math.abs(i.steer)
    if (!this.active && i.speed > cfg.minSpeed) {
      const auto = cfg.autoEntries
      const fast = auto && i.speed > cfg.fastSpeed && lock >= cfg.fastLock && i.throttle > 0.5
      const tapped = auto && lock >= cfg.entryLock && this.brakeArm > 0 && !braking
      const kicked = auto && lock >= cfg.entryLock && this.downshiftArm > 0
      const yanked = i.handbrake && lock >= 0.3
      // Drift tap: a short brake press while turning (or turning just after it).
      const flicked = this.tapArm > 0 && lock >= cfg.entryLock && !braking
      if (fast || tapped || kicked || yanked || flicked) {
        this.active = true
        this.calm = this.counter = 0
        this.score = 0
        this.brakeArm = this.downshiftArm = this.tapArm = 0
        this.entry = this.direction = i.steer > 0 ? 1 : -1
      }
    }

    if (this.active) {
      // The driver ends it: wheel back near straight (no countersteer holding the
      // angle). Waiting for the slip to drop instead never ends — the rear is
      // still loose while the drift lasts.
      const straight = lock < 0.25 && !i.handbrake
      this.calm = straight ? this.calm + dt : 0
      const countering = i.steer * this.direction < -0.25
      this.counter = countering ? this.counter + dt : 0
      const ended =
        this.calm > cfg.exitTime ||
        this.counter > cfg.counterExitTime ||
        i.speed < cfg.minSpeed * 0.6 ||
        (i.brake > 0.8 && i.slipAngle < cfg.exitAngle * 2)
      if (ended) {
        this.active = false
        this.lastScore = Math.round(this.score)
        this.sinceEnd = 0
      } else {
        // Points: km/h × degrees of angle, per second.
        this.score += (i.speed * 3.6 * (i.slipAngle * 57.3) * dt) / 50
      }
    }
    if (!this.active) this.sinceEnd += dt

    const target = this.active ? 1 : 0
    const tau = this.active ? cfg.attack : cfg.release
    this.amount += (target - this.amount) * (1 - Math.exp(-dt / tau))
    if (!this.active && this.amount < 0.01) this.amount = 0
  }

  /**
   * Target body angle and path turn rate for a drift at `speed` (m/s) with this
   * steering. `s` is steering relative to the drift: +1 = full lock into it,
   * -1 = full countersteer. Signed about +Y: a right-hand drift turns clockwise
   * (negative) and points the nose right of the travel direction (negative).
   */
  guide(steer: number, speed: number, cfg: DriftConfig, out: DriftGuide): DriftGuide {
    const s = Math.max(-1, Math.min(1, steer * this.direction))
    const into = Math.max(0, s)
    const counter = Math.max(0, -s)
    const angle = cfg.baseAngle + (cfg.holdAngle - cfg.baseAngle) * into - (cfg.baseAngle - cfg.minAngle) * counter
    const g = cfg.pathG * (1 + cfg.pathGain * into - cfg.pathCounter * counter)
    const rate = Math.min(2.5, (g * 9.81) / Math.max(speed, 5))
    const sign = -this.direction // right (+1) is clockwise about +Y
    out.angle = sign * angle
    out.pathRate = sign * rate
    return out
  }

  /** Rear lateral grip multiplier for this tick. */
  rearGripScale(throttle: number, cfg: DriftConfig): number {
    const drifting = cfg.rearGrip - cfg.throttleGripLoss * throttle
    return 1 - this.amount * (1 - drifting)
  }

  reset(): void {
    this.amount = 0
    this.active = false
    this.entry = this.direction = 0
    this.score = this.lastScore = 0
    this.sinceEnd = Infinity
    this.brakeArm = this.downshiftArm = this.calm = this.counter = this.tapArm = this.brakeHeld = 0
    this.wasBraking = this.steeredWhileBraking = false
  }
}
