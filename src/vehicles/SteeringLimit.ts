import { arcadeTurnRadius, type ArcadeHandlingConfig } from './ArcadeHandling'
/** Shared steering envelope: the AI must normalise against the car's actual lock. */
export interface SteeringLimitConfig {
  arcade?: ArcadeHandlingConfig
  wheelbase: number
  maxSteerAngle: number
  steerFalloffSpeed: number
  grip?: number
  downforcePerKg?: number
  peakSlip?: number
  /** Fraction of peak tire slip added to the grip-limited turn angle; 0 disables the cap. */
  steerPeakSlipScale?: number
}

export function steeringLimit(config: SteeringLimitConfig, speed: number, driftAmount = 0, surfaceGrip = 1): number {
  const v = Math.abs(speed)
  const falloff = 1 / (1 + v / config.steerFalloffSpeed)
  const legacy = config.maxSteerAngle * falloff
  const scale = config.steerPeakSlipScale ?? 0.5
  let gripLimit = legacy
  if (config.grip !== undefined && config.peakSlip !== undefined && scale > 0 && v > 1) {
    const normalAcceleration = Math.max(0, 9.81 + (config.downforcePerKg ?? 0) * v * v)
    const lateralAcceleration = config.grip * surfaceGrip * normalAcceleration
    const kinematicAngle = Math.atan(config.wheelbase * lateralAcceleration / (v * v))
    gripLimit = Math.min(legacy, kinematicAngle + config.peakSlip * scale)
  }
  if (config.arcade?.enabled) {
    const traction = Math.max(.1, Math.min(1, surfaceGrip))
    const radius = Math.max(arcadeTurnRadius(config.arcade, v) / traction,
      v * v / (config.arcade.maxLateralG * 9.81 * traction))
    gripLimit = Math.min(config.maxSteerAngle, Math.atan(config.wheelbase / radius))
  }
  // A held handbrake or an active drift needs real opposite lock, not grip steering.
  const driftLock = config.maxSteerAngle * Math.max(falloff, 0.55)
  const blend = Math.max(0, Math.min(1, driftAmount))
  return gripLimit + (driftLock - gripLimit) * blend
}
