/**
 * Drift state machine and guidance (NFS / Asphalt-style). Pure — numbers in,
 * numbers out — so it's unit tested and VehicleController only maps it onto
 * the car: `amount` scales tire grip and the stability assist, `guide()` gives
 * the drift angle and path the controller steers the car along.
 *
 * Arcade drifting, not a tire-physics slide: once in, the car settles at a
 * big, stable body angle and carves a smooth arc. The arc is measured against
 * the car's own full-lock grip turn at that speed, so a drift always rounds a
 * corner: steering INTO it turns tighter than gripping would (the way through
 * a hairpin at speed), centred is a fast sweeper, countersteer opens the line
 * out. The cost is speed: the steeper the angle, the more it scrubs, and
 * lifting scrubs more and lets the angle fall. The throttle holds it out.
 * Countersteering hard on the throttle swings the car into a drift the other
 * way (a transition, for S-bends); off the throttle it ends the drift.
 * Straightening up ends it too; the exit then
 * unwinds the angle — mostly the body swinging back to the line, partly the
 * line swinging toward the nose — before grip takes over, so it never flicks.
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
  /** Share of the angle kept with the throttle shut (full throttle keeps all of it). */
  liftAngle: number
  /**
   * Turn rate of the drift's arc as a share of the car's full-lock grip turn
   * at the same speed: full lock into the drift, centred, full countersteer.
   */
  turnInto: number
  turnNeutral: number
  turnCounter: number
  /** Countersteering this long (s) ends the drift. */
  counterExitTime: number
  /**
   * Hard countersteer (past `transitionLock`) on the throttle for this long (s) swings the car
   * into a drift the other way instead (an S-bend transition). Must be under counterExitTime.
   */
  transitionTime: number
  transitionLock: number
  /**
   * The steering the drift follows eases toward the driver's over this long (s). Keys are all
   * or nothing: tapped to hold a line, they made the arc jump between two rates each tap (the
   * car wobbled); eased, a tapped key sets an in-between angle and arc, as a wheel would.
   */
  steerSmoothing: number
  /** Speed lost per second while drifting (fraction), plus this much × sin²(body angle), plus this much off the throttle. */
  scrub: number
  angleScrub: number
  liftScrub: number
  /** How much of the tires' sideways grip the drift takes over (0..1). */
  lateralRelief: number
  /** How quickly the body swings to the target angle (1/s) and the yaw rate settles (1/s). */
  angleGain: number
  yawResponse: number
  /** Most the body may swing relative to the arc, rad/s: a smooth entry, not a whip. */
  maxSwing: number
  /** Exit: share of the leftover angle taken out by turning the line toward the nose (the rest by the body swinging back). */
  exitAlign: number
  /** Exit is done below this body angle (rad), or after this long (s). */
  exitSettle: number
  exitMaxSec: number
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
  release: 0.18,
  exitTime: 0.4,
  exitAngle: 0.1,
  tapMaxSec: 0.25,
  baseAngle: 0.5,
  holdAngle: 0.72,
  minAngle: 0.15,
  liftAngle: 0.7,
  turnInto: 1.2,
  turnNeutral: 0.75,
  turnCounter: 0.3,
  counterExitTime: 0.7,
  transitionTime: 0.35,
  transitionLock: 0.6,
  steerSmoothing: 0.35,
  scrub: 0.03,
  angleScrub: 0.65,
  liftScrub: 0.12,
  lateralRelief: 0.8,
  angleGain: 3,
  yawResponse: 9,
  maxSwing: 1.05,
  exitAlign: 0.3,
  exitSettle: 0.07,
  exitMaxSec: 0.8,
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

/** Internal checkpoint for the same approved configuration; not a client input format. */
export interface DriftState {
  amount: number
  active: boolean
  exiting: boolean
  entry: number
  direction: number
  score: number
  lastScore: number
  sinceEnd: number | null
  brakeHeld: number
  steeredWhileBraking: boolean
  tapArm: number
  counter: number
  brakeArm: number
  downshiftArm: number
  wasBraking: boolean
  calm: number
  exitTimer: number
  steer: number
}

export class Drift {
  /** 0..1: how much drift handling is applied right now (eased). */
  amount = 0
  /** True while a drift is under way (entered, not yet ended). */
  active = false
  /** True after a drift ends while the leftover angle unwinds (guidance still holds the car). */
  exiting = false
  /** Set for the single tick a drift starts: -1 into a left turn, 1 right, 0 none. */
  entry = 0
  /** Which way the current drift turns: -1 left, 1 right (kept after it ends). */
  direction = 0
  /** Drift points of the drift under way: speed × angle × time. */
  score = 0
  /** Points of the last finished drift, and seconds since it finished (for the HUD). */
  lastScore = 0
  sinceEnd = Infinity
  /** The driver's steering as the drift follows it (eased, see DriftConfig.steerSmoothing): pass it to guide(). */
  steer = 0

  private brakeHeld = 0
  private steeredWhileBraking = false
  private tapArm = 0
  private counter = 0

  private brakeArm = 0
  private downshiftArm = 0
  private wasBraking = false
  private calm = 0
  private exitTimer = 0

  update(i: DriftInput, cfg: DriftConfig, dt: number): void {
    this.entry = 0
    this.steer += (Math.max(-1, Math.min(1, i.steer)) - this.steer) * (cfg.steerSmoothing > 0 ? 1 - Math.exp(-dt / cfg.steerSmoothing) : 1)
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
        this.exiting = false
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
      // Transition: hard opposite lock with the power on throws the car the other way, linked.
      if (this.counter > cfg.transitionTime && i.steer * this.direction < -cfg.transitionLock && i.throttle > 0.5 && i.speed > cfg.minSpeed) {
        this.direction = -this.direction
        this.entry = this.direction
        this.counter = this.calm = 0
      }
      const ended =
        this.calm > cfg.exitTime ||
        this.counter > cfg.counterExitTime ||
        i.speed < cfg.minSpeed * 0.6 ||
        (i.brake > 0.8 && i.slipAngle < cfg.exitAngle * 2)
      if (ended) {
        this.active = false
        this.exiting = true
        this.exitTimer = 0
        this.lastScore = Math.round(this.score)
        this.sinceEnd = 0
      } else {
        // Points: km/h × degrees of angle, per second.
        this.score += (i.speed * 3.6 * (i.slipAngle * 57.3) * dt) / 50
      }
    }
    if (!this.active) this.sinceEnd += dt
    if (this.exiting) {
      this.exitTimer += dt
      if (i.slipAngle < cfg.exitSettle || this.exitTimer > cfg.exitMaxSec || i.speed < cfg.minSpeed * 0.4) this.exiting = false
    }

    // The exit keeps the guidance on until the angle has unwound; only then does grip take back over.
    const held = this.active || this.exiting
    const target = held ? 1 : 0
    const tau = held ? cfg.attack : cfg.release
    this.amount += (target - this.amount) * (1 - Math.exp(-dt / tau))
    if (!this.active && this.amount < 0.01) this.amount = 0
  }

  /**
   * Target body angle and path turn rate for this tick.
   *  - `steer` -1..1 as the driver holds it; relative to the drift, +1 is full
   *    lock into it and -1 full countersteer.
   *  - `gripRate`: the car's full-lock grip turn rate at this speed, rad/s
   *    (unsigned). The arc is a share of it, so a drift turns like the car does.
   *  - `beta`: current body angle, travel direction → nose, signed about +Y.
   * Signed about +Y: a right-hand drift turns clockwise (negative) and points
   * the nose right of the travel direction (negative).
   */
  guide(steer: number, throttle: number, gripRate: number, beta: number, cfg: DriftConfig, out: DriftGuide): DriftGuide {
    if (!this.active) {
      // Exit: unwind the leftover angle. Mostly the body swings back to the line;
      // a share comes from the line swinging toward the nose (the slingshot out).
      out.angle = 0
      out.pathRate = beta * cfg.exitAlign * cfg.angleGain
      return out
    }
    const s = Math.max(-1, Math.min(1, steer * this.direction))
    const into = Math.max(0, s)
    const counter = Math.max(0, -s)
    const lift = 1 - Math.max(0, Math.min(1, throttle))
    const angle = (cfg.baseAngle + (cfg.holdAngle - cfg.baseAngle) * into - (cfg.baseAngle - cfg.minAngle) * counter) *
      (1 - (1 - cfg.liftAngle) * lift)
    const share = s >= 0 ? cfg.turnNeutral + (cfg.turnInto - cfg.turnNeutral) * into : cfg.turnNeutral - (cfg.turnNeutral - cfg.turnCounter) * counter
    const rate = Math.min(2.5, Math.max(0, gripRate) * share)
    const sign = -this.direction // right (+1) is clockwise about +Y
    out.angle = sign * angle
    out.pathRate = sign * rate
    return out
  }

  /** Share of speed scrubbed per second at body angle `beta` (rad) and this throttle. */
  scrubRate(beta: number, throttle: number, cfg: DriftConfig): number {
    const side = Math.sin(beta)
    return cfg.scrub + cfg.angleScrub * side * side + cfg.liftScrub * (1 - Math.max(0, Math.min(1, throttle)))
  }

  /** Rear lateral grip multiplier for this tick. */
  rearGripScale(throttle: number, cfg: DriftConfig): number {
    const drifting = cfg.rearGrip - cfg.throttleGripLoss * throttle
    return 1 - this.amount * (1 - drifting)
  }

  /** Allocate a detached checkpoint outside the per-tick update path. Infinity sentinels use null. */
  captureState(): DriftState {
    return {
      amount: this.amount,
      active: this.active,
      exiting: this.exiting,
      entry: this.entry,
      direction: this.direction,
      score: this.score,
      lastScore: this.lastScore,
      sinceEnd: this.sinceEnd === Infinity ? null : this.sinceEnd,
      brakeHeld: this.brakeHeld,
      steeredWhileBraking: this.steeredWhileBraking,
      tapArm: this.tapArm,
      counter: this.counter,
      brakeArm: this.brakeArm,
      downshiftArm: this.downshiftArm,
      wasBraking: this.wasBraking,
      calm: this.calm,
      exitTimer: this.exitTimer,
      steer: this.steer,
    }
  }

  /** Restore a trusted checkpoint with the same config before replaying inputs. */
  restoreState(state: DriftState): void {
    this.amount = state.amount
    this.active = state.active
    this.exiting = state.exiting
    this.entry = state.entry
    this.direction = state.direction
    this.score = state.score
    this.lastScore = state.lastScore
    this.sinceEnd = state.sinceEnd ?? Infinity
    this.brakeHeld = state.brakeHeld
    this.steeredWhileBraking = state.steeredWhileBraking
    this.tapArm = state.tapArm
    this.counter = state.counter
    this.brakeArm = state.brakeArm
    this.downshiftArm = state.downshiftArm
    this.wasBraking = state.wasBraking
    this.calm = state.calm
    this.exitTimer = state.exitTimer
    this.steer = state.steer
  }

  reset(): void {
    this.amount = 0
    this.active = this.exiting = false
    this.exitTimer = 0
    this.entry = this.direction = 0
    this.score = this.lastScore = 0
    this.sinceEnd = Infinity
    this.brakeArm = this.downshiftArm = this.calm = this.counter = this.tapArm = this.brakeHeld = 0
    this.wasBraking = this.steeredWhileBraking = false
    this.steer = 0
  }
}
