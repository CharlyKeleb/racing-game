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
}

export interface TireOutput {
  longitudinal: number
  lateral: number
  /** 0..1 — how far into the friction circle we are. Drives nitro fill and audio. */
  slip: number
  /**
   * How fast the contact patch is actually sliding over the ground, m/s: past
   * the peak slip angle, locked by the handbrake, or spinning under power.
   * Zero in ordinary grippy cornering and ABS braking. Drives marks and smoke.
   */
  slide: number
}

export function computeTireForces(input: TireInput, cfg: TireConfig): TireOutput {
  const { vLong, vLat, load, handbrake, massShare, dt } = input
  if (load <= 0) return { longitudinal: 0, lateral: 0, slip: 0, slide: 0 }

  const gripScale = handbrake ? cfg.handbrakeGripScale : 1
  const maxForce = load * cfg.grip * gripScale * (input.surfaceGrip ?? 1)

  // Lateral: slip-angle model at speed, velocity-cancelling impulse at low speed
  // (otherwise the car jitters sideways when parked).
  let lateral: number
  const speed = Math.abs(vLong)
  if (speed > LOW_SPEED) {
    const slipAngle = Math.atan2(vLat, speed)
    lateral = -lateralForceCurve(slipAngle, cfg) * maxForce
  } else {
    lateral = (-vLat * massShare) / dt
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
  const total = Math.hypot(longitudinal, lateral)
  let slip = total / maxForce
  if (total > maxForce) {
    if (cfg.tractionControl) {
      // Arcade: cornering grip wins, drive/brake gets what's left. Stops
      // full-throttle power oversteer; handbrake drifts still work.
      lateral = Math.max(-maxForce, Math.min(maxForce, lateral))
      const rest = Math.sqrt(maxForce * maxForce - lateral * lateral)
      longitudinal = Math.max(-rest, Math.min(rest, longitudinal))
    } else {
      const k = maxForce / total
      longitudinal *= k
      lateral *= k
    }
  }
  if (handbrake) slip = Math.max(slip, Math.min(1, Math.abs(vLat) / 4))

  let slide: number
  if (handbrake && speed > 0.5) {
    // Locked rear wheel: the whole patch skids.
    slide = Math.hypot(vLong, vLat)
  } else {
    slide = speed > LOW_SPEED ? Math.max(0, Math.abs(vLat) - speed * Math.tan(peakSlipAngle(cfg))) : 0
    // Drive force the tire couldn't transmit becomes wheelspin. Braking force it
    // couldn't transmit doesn't lock the wheel: ABS holds it at the peak.
    const driving = requested * (vLong >= 0 ? 1 : -1) > 0
    if (driving && Math.abs(unclamped) > 1) {
      const lost = Math.max(0, 1 - Math.abs(longitudinal) / Math.abs(unclamped))
      slide = Math.max(slide, lost * SPIN_SLIDE)
    }
  }

  return { longitudinal, lateral, slip: Math.min(1, slip), slide }
}
