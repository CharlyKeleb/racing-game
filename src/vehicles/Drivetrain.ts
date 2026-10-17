import type { EngineConfig } from './VehicleConfig'

/** -1 = reverse, 0 = neutral, 1..n = forward gears. */
export type Gear = number

/** Direction the player asks for at a standstill: -1 reverse, 1 forward, 0 no change. */
export type GearRequest = -1 | 0 | 1

const RPM_PER_RAD_S = 60 / (2 * Math.PI)

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
 * Engine + automatic gearbox. Pure — fed wheel speed, returns force at the
 * driven wheels. Manual shifting is a later feature (shiftUp/shiftDown exist).
 */
export class Drivetrain {
  gear: Gear = 1
  rpm: number
  private shiftTimer = 0
  private readonly cfg: EngineConfig

  constructor(cfg: EngineConfig) {
    this.cfg = cfg
    this.rpm = cfg.idleRpm
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
   * @returns total longitudinal force at the contact patches of driven wheels, N.
   */
  update(wheelSpeed: number, wheelRadius: number, throttle: number, request: GearRequest, dt: number): number {
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
    this.autoShift()

    const limiter = this.rpm >= cfg.redlineRpm ? 0 : 1
    const engineTorque = torqueAt(this.rpm, cfg.torqueCurve) * throttle * limiter
    return (engineTorque * ratio * cfg.efficiency) / wheelRadius
  }

  private autoShift(): void {
    if (this.gear <= 0) return
    if (this.rpm > this.cfg.shiftUpRpm && this.gear < this.topGear) this.shift(this.gear + 1)
    else if (this.rpm < this.cfg.shiftDownRpm && this.gear > 1) this.shift(this.gear - 1)
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
