import type { TireConfig } from './VehicleConfig'

/**
 * Pure tire model — no Three.js or Rapier types so it can be unit tested and,
 * later, run on an authoritative multiplayer server.
 */

const LOW_SPEED = 1.5 // m/s, below this slip angles become noise

/** Normalised lateral force (-1..1) for a slip angle in radians. Pacejka-lite. */
export function lateralForceCurve(slipAngle: number, cfg: TireConfig): number {
  return Math.sin(cfg.shape * Math.atan(cfg.corneringStiffness * slipAngle))
}

/**
 * Slip angle (radians) where the lateral curve peaks. Beyond it the tire is
 * sliding rather than gripping: that's when real tires smoke and leave marks.
 */
export function peakSlipAngle(cfg: TireConfig): number {
  return cfg.shape > 1 ? Math.tan(Math.PI / (2 * cfg.shape)) / cfg.corneringStiffness : Math.PI / 2
}

/** Wheelspin surface speed (m/s) at a fully saturated driven tire. */
const SPIN_SLIDE = 6
/**
 * Braking past the grip limit: ABS holds the tire near peak, but that peak is
 * at ~10–15% slip, so the patch still scrubs at this share of road speed —
 * a hard stop from 200 km/h smokes, a gentle or slow one doesn't.
 */
const ABS_SLIP = 0.12
/** Fraction of brake force over the limit that counts as fully at it. */
const ABS_FULL = 0.12

export interface TireInput {
  /** Contact patch velocity projected on the wheel's forward axis, m/s. */
  vLong: number
  /** Contact patch velocity projected on the wheel's right axis, m/s. */
  vLat: number
  /** Suspension normal load, N. */
  load: number
  /** Requested longitudinal force from drivetrain minus brakes, N. */
  longitudinalForce: number
  handbrake: boolean
  /** Mass share supported by this wheel, kg — used for low-speed damping. */
  massShare: number
  dt: number
  /** Surface friction multiplier (Surface.ts). Default 1 (asphalt). */
  surfaceGrip?: number
  /** Extra rolling resistance coefficient from the surface. Default 0. */
  surfaceDrag?: number
  /** Multiplier on cornering grip only (drifting rears let go). Default 1. */
  lateralGripScale?: number
  /**
   * Share the friction circle between drive and cornering instead of giving
   * cornering priority (traction control off for this tire): power then pushes
   * the tire wide — what lets the throttle hold a drift. Default false.
   */
  arcadeGripScale?: number
  postPeakGrip?: number
  combined?: boolean
}

export interface TireOutput {
  longitudinal: number
  lateral: number
  /** 0..1 — how far into the friction circle we are. Drives nitro fill and audio. */
  slip: number
  /**
   * How fast the contact patch is actually sliding over the ground, m/s: past
   * the peak slip angle, locked by the handbrake, or spinning under power.
   * Zero in ordinary grippy cornering and gentle braking. Drives marks and smoke.
   */
  slide: number
}

export function computeTireForces(input: TireInput, cfg: TireConfig): TireOutput {
  const { vLong, vLat, load, handbrake, massShare, dt } = input
  if (load <= 0) return { longitudinal: 0, lateral: 0, slip: 0, slide: 0 }

  const gripScale = handbrake ? cfg.handbrakeGripScale : 1
  const maxForce = load * cfg.grip * gripScale * (input.surfaceGrip ?? 1)

  if (maxForce <= 0) return { longitudinal: 0, lateral: 0, slip: 0, slide: 0 }

  // Lateral: slip-angle model at speed, velocity-cancelling impulse at low speed
  // (otherwise the car jitters sideways when parked).
  let lateral: number
  const speed = Math.abs(vLong)
  const lateralBudget = maxForce * Math.max(1, input.arcadeGripScale ?? 1)
  const lateralMax = lateralBudget * (input.lateralGripScale ?? 1)
  if (speed > LOW_SPEED) {
    const slipAngle = Math.atan2(vLat, speed)
    let force = lateralForceCurve(slipAngle, cfg)
    if (Math.abs(slipAngle) > peakSlipAngle(cfg)) {
      const plateau = Math.max(0, Math.min(1, input.postPeakGrip ?? 0))
      force += (Math.sign(slipAngle) - force) * plateau
    }
    lateral = -force * lateralMax
  } else {
    // Still limited by grip: a tyre spinning in a burnout can't hold the tail in place.
    lateral = Math.max(-lateralMax, Math.min(lateralMax, (-vLat * massShare) / dt))
  }
  // Never apply more than it takes to cancel sideways motion this tick —
  // prevents overshoot oscillation at low speed / small slip angles.
  const cancel = (Math.abs(vLat) * massShare) / dt
  lateral = Math.max(-cancel, Math.min(cancel, lateral))

  // Rolling resistance, capped so it stops the wheel rather than reversing it
  // (sand drag is large enough to jitter a parked car otherwise).
  const rolling = Math.min((cfg.rollingResistance + (input.surfaceDrag ?? 0)) * load, (speed * massShare) / dt)
  const requested = input.longitudinalForce
  let longitudinal = requested - Math.sign(vLong) * rolling
  const unclamped = longitudinal

  // Friction circle: combined force can't exceed max grip.
  const total = Math.hypot(longitudinal / maxForce, lateral / lateralBudget)
  let slip = total
  if (total > 1) {
    if (cfg.tractionControl && !input.combined) {
      // Arcade: cornering grip wins, drive/brake gets what's left. Stops
      // full-throttle power oversteer; handbrake drifts still work.
      lateral = Math.max(-lateralBudget, Math.min(lateralBudget, lateral))
      const rest = maxForce * Math.sqrt(Math.max(0, 1 - (lateral / lateralBudget) ** 2))
      longitudinal = Math.max(-rest, Math.min(rest, longitudinal))
    } else {
      const k = 1 / total
      longitudinal *= k
      lateral *= k
    }
  }
  lateral = Math.max(-lateralMax, Math.min(lateralMax, lateral))
  if (handbrake) slip = Math.max(slip, Math.min(1, Math.abs(vLat) / 4))

  let slide: number
  if (handbrake && speed > 0.5) {
    // Locked rear wheel: the whole patch skids.
    slide = Math.hypot(vLong, vLat)
  } else {
    slide = speed > LOW_SPEED ? Math.max(0, Math.abs(vLat) - speed * Math.tan(peakSlipAngle(cfg))) : 0
    // Drive force the tire couldn't transmit becomes wheelspin. Braking force it
    // couldn't transmit doesn't lock the wheel (ABS), but it does run the tire
    // at its peak slip, which scrubs at a share of road speed.
    const driving = requested * (vLong >= 0 ? 1 : -1) > 0
    if (Math.abs(unclamped) > 1) {
      const lost = Math.max(0, 1 - Math.abs(longitudinal) / Math.abs(unclamped))
      const scrub = driving ? lost * SPIN_SLIDE : Math.min(1, lost / ABS_FULL) * ABS_SLIP * speed
      slide = Math.max(slide, scrub)
    }
  }

  return { longitudinal, lateral, slip: Math.min(1, slip), slide }
}
