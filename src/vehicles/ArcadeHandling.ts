/** Independently implemented arcade tuning; reference analysis lives in docs. */
export interface ArcadeHandlingConfig {
  enabled: boolean
  /** [speed km/h, full-lock radius metres], interpolated between points. */
  turnRadius: readonly (readonly [number, number])[]
  lateralGripMultiplier: number
  postPeakGrip: number
  maxLateralG: number
  assistMaxG: number
  yawResponse: number
  maxYawAcceleration: number
  sidewaysRecovery: number
  minSpeed: number
}

export function arcadeTurnRadius(config: ArcadeHandlingConfig, speed: number): number {
  const points = config.turnRadius
  if (points.length === 0) return Infinity
  const kmh = Math.abs(speed) * 3.6
  let previous = points[0]
  for (let i = 1; i < points.length; i++) {
    const next = points[i]
    if (kmh <= next[0]) {
      const t = Math.max(0, Math.min(1, (kmh - previous[0]) / Math.max(.001, next[0] - previous[0])))
      return Math.max(.1, previous[1] + (next[1] - previous[1]) * t)
    }
    previous = next
  }
  return Math.max(.1, previous[1])
}
