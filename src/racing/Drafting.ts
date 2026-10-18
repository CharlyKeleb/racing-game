import type { DriverPose, TrafficCar } from './AiDriver'

/** Slipstream earned by following a moving, aligned racer. Same rule for all cars. */
export function draftingStrength(pose: DriverPose, traffic: readonly TrafficCar[], id: number): number {
  if (pose.speed < 12) return 0
  const fx = Math.sin(pose.heading), fz = Math.cos(pose.heading)
  let strength = 0
  for (const car of traffic) {
    if (car.id === id || car.speed < 10 || Math.cos(car.heading - pose.heading) < 0.9) continue
    const dx = car.x - pose.x, dz = car.z - pose.z
    const ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx)
    if (ahead < 9 || ahead > 40 || side > 1.8) continue
    strength = Math.max(strength, (1 - side / 1.8) * Math.min(1, (40 - ahead) / 20))
  }
  return strength
}
