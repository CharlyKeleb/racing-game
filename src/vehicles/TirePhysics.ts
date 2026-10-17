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
}

export interface TireOutput {
  longitudinal: number
  lateral: number
  /** 0..1 — how far into the friction circle we are. Drives skid marks and audio. */
  slip: number
}

export function computeTireForces(input: TireInput, cfg: TireConfig): TireOutput {
  const { vLong, vLat, load, handbrake, massShare, dt } = input
  if (load <= 0) return { longitudinal: 0, lateral: 0, slip: 0 }

  const gripScale = handbrake ? cfg.handbrakeGripScale : 1
  const maxForce = load * cfg.grip * gripScale

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

  let longitudinal = input.longitudinalForce - Math.sign(vLong) * cfg.rollingResistance * load

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

  return { longitudinal, lateral, slip: Math.min(1, slip) }
}
