/** Times for traversing the currently available steering lock, in seconds. */
export interface KeyboardSteeringConfig {
  turnInSec: number
  returnSec: number
  countersteerSec: number
}

function approach(value: number, target: number, step: number): number {
  return value + Math.max(-step, Math.min(step, target - value))
}

/**
 * Give digital keys a consistent build-up time at every speed. The caller still
 * supplies the car's grip/speed-limited lock. Reversal returns through centre
 * quickly, then uses the normal turn-in rate for the new direction.
 */
export function keyboardSteeringAngle(
  current: number, target: number, available: number, dt: number, config: KeyboardSteeringConfig,
): number {
  if (dt <= 0) return current
  if (available <= 0) return 0
  if (current * target < 0) {
    const rate = available / Math.max(.001, config.countersteerSec)
    const toCentre = Math.abs(current) / rate
    if (dt <= toCentre) return approach(current, 0, rate * dt)
    current = 0
    dt -= toCentre
  }
  const centering = Math.abs(target) < Math.abs(current)
  const rate = available / Math.max(.001, centering ? config.returnSec : config.turnInSec)
  return approach(current, target, rate * dt)
}
