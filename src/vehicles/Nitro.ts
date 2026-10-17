import type { NitroConfig } from './VehicleConfig'

/** Per-tick inputs to the nitro system. Plain numbers so it can run on a server. */
export interface NitroInput {
  /** Mean tire slip of the grounded wheels, 0..1 (see TirePhysics). */
  slip: number
  /** Chassis speed, m/s (unsigned). */
  speed: number
  /** True while at least one wheel touches the ground. */
  grounded: boolean
  /** Boost button held. */
  wantsBoost: boolean
}

/**
 * Asphalt-style nitro. Pure — numbers in, numbers out, unit tested.
 *
 * The tank (0..1) fills while the tires work near or past the grip limit
 * (drifting, hard cornering) and drains while the boost button is held.
 * A boost needs `minCharge` to start but then runs until released or empty.
 * `intensity` ramps toward 1 while boosting so the force and camera kick in
 * over a few frames rather than in one step.
 */
export class Nitro {
  /** Tank level, 0..1. */
  charge = 0
  /** True while a boost is burning. */
  active = false
  /** Smoothed boost amount, 0..1. Scales force, drag and visuals. */
  intensity = 0
  private readonly cfg: NitroConfig

  constructor(cfg: NitroConfig) {
    this.cfg = cfg
  }

  update(input: NitroInput, dt: number): void {
    const cfg = this.cfg

    if (this.active) {
      if (!input.wantsBoost || this.charge <= 0) this.active = false
    } else if (input.wantsBoost && this.charge >= cfg.minCharge) {
      this.active = true
    }

    if (this.active) {
      this.charge = Math.max(0, this.charge - dt / cfg.durationSec)
    } else {
      this.charge = Math.min(1, this.charge + fillRate(input, cfg) * dt)
    }

    const target = this.active ? 1 : 0
    const step = cfg.rampRate * dt
    this.intensity += Math.max(-step, Math.min(step, target - this.intensity))
  }

  /** Extra drive force at the driven wheels this tick, N. */
  get force(): number {
    return this.cfg.force * this.intensity
  }

  /**
   * Multiplier on aerodynamic drag. Drag grows with v², so scaling it by
   * 1/(1+b)² raises the drag-limited top speed by the fraction b.
   */
  get dragScale(): number {
    const k = 1 + this.cfg.topSpeedBonus * this.intensity
    return 1 / (k * k)
  }

  reset(): void {
    this.charge = 0
    this.active = false
    this.intensity = 0
  }
}

/** Tank fraction per second gained from tire slip; 0 below the threshold or speed. */
export function fillRate(input: NitroInput, cfg: NitroConfig): number {
  if (!input.grounded || input.speed < cfg.minFillSpeed) return 0
  const over = (input.slip - cfg.slipThreshold) / (1 - cfg.slipThreshold)
  if (over <= 0) return 0
  return cfg.fillRate * Math.min(1, over)
}
