/**
 * Drift state machine (NFS-style). Pure — numbers in, numbers out — so it's
 * unit tested and VehicleController only maps `amount` onto tire grip, the
 * stability assist and steering lock.
 *
 * A planted car shouldn't slide just because you turn, so a drift needs an
 * entry, like the real techniques:
 *  - fast turn-in: hard lock at high speed on the throttle (weight off the rear)
 *  - brake-tap (feint): brake, release, turn in hard — the classic NFS entry
 *  - downshift + turn: engine braking on the rears as you turn in (clutch-kick)
 *  - handbrake: locks the rears (handled in the tire model; joins the drift)
 * Once sideways the rears give up grip (more with throttle, so the gas pedal
 * sets the angle), and the drift ends when the driver straightens up, slows
 * right down, or holds the brake.
 */

export interface DriftConfig {
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
}

export const DEFAULT_DRIFT: DriftConfig = {
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
  exitTime: 0.2,
  exitAngle: 0.1,
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
}

export class Drift {
  /** 0..1: how much drift handling is applied right now (eased). */
  amount = 0
  /** True while a drift is under way (entered, not yet ended). */
  active = false
  /** Set for the single tick a drift starts: -1 into a left turn, 1 right, 0 none. */
  entry = 0

  private brakeArm = 0
  private downshiftArm = 0
  private wasBraking = false
  private calm = 0

  update(i: DriftInput, cfg: DriftConfig, dt: number): void {
    this.entry = 0
    // Arm the brake-tap entry when the brake is released, the downshift entry when it happens.
    const braking = i.brake > 0.4
    if (this.wasBraking && !braking) this.brakeArm = cfg.armTime
    this.wasBraking = braking
    if (i.downshift && i.throttle < 0.3) this.downshiftArm = cfg.armTime
    this.brakeArm = Math.max(0, this.brakeArm - dt)
    this.downshiftArm = Math.max(0, this.downshiftArm - dt)

    const lock = Math.abs(i.steer)
    if (!this.active && i.speed > cfg.minSpeed) {
      const fast = i.speed > cfg.fastSpeed && lock >= cfg.fastLock && i.throttle > 0.5
      const tapped = lock >= cfg.entryLock && this.brakeArm > 0 && !braking
      const kicked = lock >= cfg.entryLock && this.downshiftArm > 0
      const yanked = i.handbrake && lock >= 0.3
      if (fast || tapped || kicked || yanked) {
        this.active = true
        this.calm = 0
        this.brakeArm = this.downshiftArm = 0
        this.entry = i.steer > 0 ? 1 : -1
      }
    }

    if (this.active) {
      // The driver ends it: wheel back near straight (no countersteer holding the
      // angle). Waiting for the slip to drop instead never ends — the rear is
      // still loose while the drift lasts.
      const straight = lock < 0.25 && !i.handbrake
      this.calm = straight ? this.calm + dt : 0
      const ended = this.calm > cfg.exitTime || i.speed < cfg.minSpeed * 0.6 || (i.brake > 0.8 && i.slipAngle < cfg.exitAngle * 2)
      if (ended) this.active = false
    }

    const target = this.active ? 1 : 0
    const tau = this.active ? cfg.attack : cfg.release
    this.amount += (target - this.amount) * (1 - Math.exp(-dt / tau))
    if (!this.active && this.amount < 0.01) this.amount = 0
  }

  /** Rear lateral grip multiplier for this tick. */
  rearGripScale(throttle: number, cfg: DriftConfig): number {
    const drifting = cfg.rearGrip - cfg.throttleGripLoss * throttle
    return 1 - this.amount * (1 - drifting)
  }

  reset(): void {
    this.amount = 0
    this.active = false
    this.entry = 0
    this.brakeArm = this.downshiftArm = this.calm = 0
    this.wasBraking = false
  }
}
