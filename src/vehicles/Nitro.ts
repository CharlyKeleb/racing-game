import type { NitroConfig } from './VehicleConfig'

/** Per-tick inputs to the nitro system. Plain numbers so it can run on a server. */
export interface NitroInput {
  /** Mean tire slip of the grounded wheels, 0..1 (see TirePhysics). */
  slip: number
  /** Chassis speed, m/s (unsigned). */
  speed: number
  /** True while at least one wheel touches the ground. */
  grounded: boolean
  /** True while no wheel touches the ground (a jump, a crest taken flat out). */
  airborne: boolean
  /** True during a drift (Drift.active): the main way to earn nitro. */
  drifting?: boolean
  /** Boost button held. */
  wantsBoost: boolean
  /** Aligned slipstream strength, 0..1; requires moving traffic and grounded tires. */
  drafting?: number
}

/**
 * Asphalt-style nitro. Pure — numbers in, numbers out, unit tested.
 *
 * Filling: the tank (0..1) fills while the tires work near or past the grip
 * limit (drifting, hard cornering) and while the car is airborne.
 *
 * Burning: holding the button burns the tank (needs `minCharge` to start).
 * Letting go ends the burn after a short grace, so a quick re-tap keeps it.
 *
 * Perfect nitro: a moment into each burn a timing window opens (`windowOpen`,
 * cued on the HUD). Tapping again inside it fires a perfect boost, stronger
 * but hungrier, for `perfectDurationSec`. One try per burn: a tap outside
 * the window spends it (`missed`).
 *
 * `intensity` ramps toward the target (1, or `perfectBoost`) so the thrust and
 * camera kick in over a few frames rather than in one step.
 */
/** Ignition kick: up to this share of the boost force extra, fading over SURGE_SEC seconds. */
const SURGE_SHARE = 0.6
const SURGE_SEC = 0.45

/** Internal checkpoint for the same approved configuration; not a client input format. */
export interface NitroState {
  charge: number
  active: boolean
  perfect: boolean
  missed: boolean
  missedAt: number
  intensity: number
  ignited: boolean
  surge: number
  burnTime: number
  perfectLeft: number
  attempted: boolean
  releasedFor: number
  wasHeld: boolean
}

export class Nitro {
  /** Tank level, 0..1. */
  charge = 0
  /** True while a boost is burning. */
  active = false
  /** True during a perfect boost. */
  perfect = false
  /** True once this burn's perfect window was missed by a badly timed tap. */
  missed = false
  /** `burnTime` when the miss happened, for a brief HUD flash. */
  missedAt = 0
  /** Smoothed boost amount: 0..1, up to `perfectBoost` during a perfect boost. */
  intensity = 0
  /** True on the tick a burn lights (for the bang, the flash and the camera punch). */
  ignited = false
  /** The kick as it lights: 1 at ignition, gone after SURGE_SEC (see surgeForce). */
  surge = 0
  /** Seconds since the current burn started. */
  burnTime = 0
  private perfectLeft = 0
  /** This burn's one perfect attempt has been used (hit or missed). */
  private attempted = false
  private releasedFor = 0
  private wasHeld = false
  private readonly cfg: NitroConfig

  constructor(cfg: NitroConfig) {
    this.cfg = cfg
  }

  update(input: NitroInput, dt: number): void {
    const cfg = this.cfg
    this.ignited = false
    this.surge = Math.max(0, this.surge - dt / SURGE_SEC)
    const pressed = input.wantsBoost && !this.wasHeld
    this.wasHeld = input.wantsBoost
    this.releasedFor = input.wantsBoost ? 0 : this.releasedFor + dt

    if (this.active) {
      if (pressed && !this.attempted) {
        if (this.windowOpen) {
          this.perfect = true
          this.perfectLeft = cfg.perfectDurationSec
        } else {
          this.missed = true
          this.missedAt = this.burnTime
        }
        this.attempted = true
      }
      if (this.charge <= 0 || this.releasedFor > cfg.releaseGraceSec) this.stopBurn()
    } else if (input.wantsBoost && this.charge >= cfg.minCharge) {
      this.active = true
      this.ignited = true
      this.surge = 1
      this.burnTime = 0
      this.attempted = false
      this.missed = false
    }

    if (this.active) {
      this.burnTime += dt
      if (this.perfect) {
        this.perfectLeft -= dt
        if (this.perfectLeft <= 0) this.perfect = false
      }
      const drain = this.perfect ? cfg.perfectDrainScale : 1
      this.charge = Math.max(0, this.charge - (drain * dt) / cfg.durationSec)
    } else {
      this.charge = Math.min(1, this.charge + fillRate(input, cfg) * dt)
    }

    const target = this.active ? (this.perfect ? cfg.perfectBoost : 1) : 0
    const step = cfg.rampRate * dt
    this.intensity += Math.max(-step, Math.min(step, target - this.intensity))
  }

  /** True while a tap now would fire a perfect boost. */
  get windowOpen(): boolean {
    const t = this.burnTime - this.cfg.perfectWindowStart
    return this.active && !this.attempted && t >= 0 && t <= this.cfg.perfectWindowLength
  }

  /**
   * HUD cue, 0..1: how far this burn has come toward the end of the perfect
   * window (1 = window closing). 0 when there's nothing left to aim for.
   */
  get windowCue(): number {
    if (!this.active || this.attempted) return 0
    return Math.min(1, this.burnTime / (this.cfg.perfectWindowStart + this.cfg.perfectWindowLength))
  }

  /** Forward thrust this tick, N. */
  get force(): number {
    return this.cfg.force * this.intensity
  }

  /**
   * Extra thrust as the nitro lights, N: a shove in the back on top of the
   * ramping boost, gone within half a second. Kept apart from `force` so the
   * steady boost (and top speed) is unchanged.
   */
  get surgeForce(): number {
    return this.cfg.force * SURGE_SHARE * this.surge * this.surge
  }

  /**
   * Multiplier on aerodynamic drag. Drag grows with v², so scaling it by
   * 1/(1+b)² raises the drag-limited top speed by the fraction b.
   */
  get dragScale(): number {
    const k = 1 + this.cfg.topSpeedBonus * this.intensity
    return 1 / (k * k)
  }

  private stopBurn(): void {
    this.active = false
    this.perfect = false
    this.perfectLeft = 0
  }

  /** Allocate a detached checkpoint outside the per-tick update path. */
  captureState(): NitroState {
    return {
      charge: this.charge,
      active: this.active,
      perfect: this.perfect,
      missed: this.missed,
      missedAt: this.missedAt,
      intensity: this.intensity,
      ignited: this.ignited,
      surge: this.surge,
      burnTime: this.burnTime,
      perfectLeft: this.perfectLeft,
      attempted: this.attempted,
      releasedFor: this.releasedFor,
      wasHeld: this.wasHeld,
    }
  }

  /** Restore a trusted checkpoint with the same config before replaying inputs. */
  restoreState(state: NitroState): void {
    this.charge = state.charge
    this.active = state.active
    this.perfect = state.perfect
    this.missed = state.missed
    this.missedAt = state.missedAt
    this.intensity = state.intensity
    this.ignited = state.ignited
    this.surge = state.surge
    this.burnTime = state.burnTime
    this.perfectLeft = state.perfectLeft
    this.attempted = state.attempted
    this.releasedFor = state.releasedFor
    this.wasHeld = state.wasHeld
  }

  reset(): void {
    this.charge = 0
    this.intensity = 0
    this.burnTime = 0
    this.attempted = false
    this.missed = false
    this.releasedFor = 0
    this.wasHeld = false
    this.ignited = false
    this.surge = 0
    this.stopBurn()
  }
}

/** Tank fraction per second from drifting, tire slip and airtime; 0 below the minimum speed. */
export function fillRate(input: NitroInput, cfg: NitroConfig): number {
  if (input.speed < cfg.minFillSpeed) return 0
  if (input.airborne) return cfg.airFillRate
  if (!input.grounded) return 0
  const drift = input.drifting ? cfg.driftFillRate : 0
  const over = (input.slip - cfg.slipThreshold) / (1 - cfg.slipThreshold)
  return Math.max(Math.max(0, Math.min(1, input.drafting ?? 0)) * 0.10, drift, over > 0 ? cfg.fillRate * Math.min(1, over) : 0)
}
