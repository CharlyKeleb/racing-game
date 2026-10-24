import type { SuspensionConfig } from './VehicleConfig'

/** Internal checkpoint for the same approved configuration; not a client input format. */
export interface SuspensionState {
  compression: number
  velocity: number
  peak: number
  prevCompression: number
}

/** Spring-damper for one raycast wheel. Pure, unit-testable. */
export class Suspension {
  /** Current compression in meters (0 = fully extended). */
  compression = 0
  /** Compression rate, m/s (+ = compressing). A spike is a kerb or curb strike, or a landing. */
  velocity = 0
  /** Highest compression rate since the last `takePeak`, for consumers slower than the physics tick (audio). */
  private peak = 0
  private prevCompression = 0
  private readonly cfg: SuspensionConfig

  constructor(cfg: SuspensionConfig) {
    this.cfg = cfg
  }

  /**
   * @param hitDistance distance from mount to ground along the suspension axis,
   *   or null when the wheel is in the air.
   * @returns normal force in N (never negative — tires don't pull the car down).
   */
  update(hitDistance: number | null, wheelRadius: number, dt: number): number {
    this.prevCompression = this.compression
    if (hitDistance === null) {
      this.compression = 0
      this.velocity = 0
      return 0
    }
    const raw = this.cfg.restLength + wheelRadius - hitDistance
    this.compression = Math.min(Math.max(raw, 0), this.cfg.travel)
    const velocity = (this.compression - this.prevCompression) / dt
    this.velocity = velocity
    if (velocity > this.peak) this.peak = velocity
    const force = this.cfg.stiffness * this.compression + this.cfg.damping * velocity
    // Bump stop: anything past travel is resolved by the chassis collider.
    return Math.max(0, force)
  }

  /** Highest compression rate since the last call, m/s, then forget it. */
  takePeak(): number {
    const p = this.peak
    this.peak = 0
    return p
  }

  /** Distance from the mount to the wheel center, for positioning the visual wheel. */
  wheelOffset(): number {
    return this.cfg.restLength - this.compression
  }

  /** Allocate a detached checkpoint outside the per-tick update path. */
  captureState(): SuspensionState {
    return {
      compression: this.compression,
      velocity: this.velocity,
      peak: this.peak,
      prevCompression: this.prevCompression,
    }
  }

  /** Restore a trusted checkpoint with the same config before replaying inputs. */
  restoreState(state: SuspensionState): void {
    this.compression = state.compression
    this.velocity = state.velocity
    this.peak = state.peak
    this.prevCompression = state.prevCompression
  }

  reset(): void {
    this.compression = 0
    this.prevCompression = 0
    this.velocity = 0
    this.peak = 0
  }
}
