import type { EngineConfig } from './VehicleConfig'

/** -1 = reverse, 0 = neutral, 1..n = forward gears. */
export type Gear = number

/** Direction the player asks for at a standstill: -1 reverse, 1 forward, 0 no change. */
export type GearRequest = -1 | 0 | 1

const RPM_PER_RAD_S = 60 / (2 * Math.PI)
/** Brake pedal above this counts as braking for gear selection. */
const BRAKING = 0.2
/** Reverse speed cap when the car config doesn't set one, m/s (≈36 km/h). */
const DEFAULT_MAX_REVERSE = 10

export function torqueAt(rpm: number, curve: [number, number][]): number {
  if (rpm <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i]
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1]
      return t0 + ((rpm - r0) / (r1 - r0)) * (t1 - t0)
    }
  }
  return curve[curve.length - 1][1]
}

/**
 * Engine + gearbox. Pure — fed wheel speed, returns force at the driven
 * wheels. Automatic by default; with `manual` set the driver picks forward gears
 * (requestShift) and the box never shifts on its own. Reverse is still engaged
 * by holding brake at a standstill in both modes.
 */
export class Drivetrain {
  gear: Gear = 1
  /** Manual transmission (#14): no automatic up/down shifts. */
  manual = false
  rpm: number
  private shiftTimer = 0
  private readonly cfg: EngineConfig

  constructor(cfg: EngineConfig) {
    this.cfg = cfg
    this.rpm = cfg.idleRpm
  }

  private get peakTorque(): number {
    return Math.max(...this.cfg.torqueCurve.map(([, t]) => t))
  }

  get topGear(): number {
    return this.cfg.gearRatios.length - 1
  }

  private ratio(gear: Gear): number {
    if (gear === 0) return 0
    return gear < 0 ? this.cfg.gearRatios[0] : this.cfg.gearRatios[gear]
  }

  /**
   * @param wheelSpeed forward speed of the driven wheels, m/s (signed).
   * @param throttle 0..1, the pedal driving the current direction (brake in reverse).
   * @param request -1 when the player holds brake at (near) standstill, 1 when
   *   they hold throttle there. Separate from `throttle` because the pedals swap
   *   in reverse: the throttle pedal brakes, so it must still be able to ask for 1st.
   * @param braking 0..1 brake pedal. Under braking the gearbox drops gears early
   *   (rev-matched, PDK-style) instead of waiting for the revs to sag.
   * @returns total longitudinal force at the contact patches of driven wheels, N.
   */
  update(wheelSpeed: number, wheelRadius: number, throttle: number, request: GearRequest, dt: number, braking = 0): number {
    const cfg = this.cfg

    if (request < 0 && this.gear > 0 && Math.abs(wheelSpeed) < 1) this.gear = -1
    if (request > 0 && this.gear < 0 && Math.abs(wheelSpeed) < 1) this.gear = 1

    const ratio = this.ratio(this.gear) * cfg.finalDrive
    const wheelRpm = (Math.abs(wheelSpeed) / wheelRadius) * RPM_PER_RAD_S
    const coupledRpm = wheelRpm * Math.abs(ratio)
    // Clutch slip at launch: let the engine rev above wheel speed.
    const freeRev = cfg.idleRpm + throttle * (cfg.redlineRpm * 0.55 - cfg.idleRpm)
    this.rpm = Math.min(cfg.redlineRpm, Math.max(coupledRpm, this.gear === 1 || this.gear === -1 ? freeRev : cfg.idleRpm))

    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt
      return 0
    }
    if (!this.manual) this.autoShift(braking > BRAKING && throttle < 0.1)

    const limiter = this.rpm >= cfg.redlineRpm ? 0 : 1
    const engineTorque = torqueAt(this.rpm, cfg.torqueCurve) * throttle * limiter
    let drive = (engineTorque * ratio * cfg.efficiency) / wheelRadius
    // Reverse is a crawl, not a second top speed: fade the push out toward the cap.
    if (this.gear < 0 && wheelSpeed < 0) drive *= Math.max(0, 1 + wheelSpeed / (cfg.maxReverseSpeed ?? DEFAULT_MAX_REVERSE))
    if (throttle > 0.05 || this.gear === 0 || Math.abs(wheelSpeed) < 1) return drive
    // Engine braking off-throttle: pumping losses grow with rpm, so a downshift
    // (revs up) brakes harder — and loads the driven wheels, which is what lets
    // a downshift into a corner step the tail out.
    const brakeTorque = (cfg.engineBrakeTorque ?? 0.12 * this.peakTorque) * (this.rpm / cfg.redlineRpm)
    return (-Math.sign(wheelSpeed) * brakeTorque * Math.abs(ratio)) / wheelRadius
  }

  private autoShift(braking: boolean): void {
    if (this.gear <= 0) return
    if (this.rpm > this.cfg.shiftUpRpm && this.gear < this.topGear) {
      this.shift(this.gear + 1)
      return
    }
    if (this.gear <= 1) return
    if (braking) {
      // Hard on the brakes: drop a gear as soon as the lower one's revs fit
      // under the brake-downshift point, one gear per shift time — the quick
      // "brap-brap-brap" of a dual-clutch box, revs kept high for the exit.
      const lowerRpm = this.rpm * (this.ratio(this.gear - 1) / this.ratio(this.gear))
      if (lowerRpm < this.brakeDownshiftRpm) this.shift(this.gear - 1)
    } else if (this.rpm < this.cfg.shiftDownRpm) {
      this.shift(this.gear - 1)
    }
  }

  /** Rpm a braking downshift may land at: config, else 500 below the upshift point (Sport-mode PDK). */
  private get brakeDownshiftRpm(): number {
    return this.cfg.brakeDownshiftRpm ?? this.cfg.shiftUpRpm - 500
  }

  /**
   * Driver's paddle / key shift (manual mode). Up from reverse or neutral goes to 1st;
   * down stops at 1st (reverse is still brake-at-standstill). Ignored mid-shift.
   * @returns whether a shift started.
   */
  requestShift(direction: 1 | -1): boolean {
    if (this.shiftTimer > 0) return false
    const target = direction > 0 ? (this.gear <= 0 ? 1 : this.gear + 1) : this.gear - 1
    if (target < 1 || target > this.topGear || (direction < 0 && this.gear <= 0)) return false
    this.shift(target)
    return true
  }

  shift(gear: Gear): void {
    this.gear = gear
    this.shiftTimer = this.cfg.shiftTimeSec
  }

  reset(): void {
    this.gear = 1
    this.rpm = this.cfg.idleRpm
    this.shiftTimer = 0
  }
}
