/** Pure contact-to-feedback thresholds. ImpactPCM owns the procedural sound assets. */
export type ImpactKind = 'car' | 'wall' | 'ground' | 'curb'

/** Below this change in speed it's a brush, not a hit, m/s. */
const MIN_HIT = 0.6
/** A change in speed this big is as loud as it gets, m/s (a big side-swipe or a wall at ~45 km/h). */
const MAX_HIT = 12
/** Suspension compression rate that's a curb strike, m/s; and one that's as hard as it gets. */
const MIN_CURB = 1.1
const MAX_CURB = 4.5

/** 0..1 loudness of a hit from the change in speed it caused (log, as ears hear it). */
export function impactStrength(deltaV: number): number {
  if (deltaV < MIN_HIT) return 0
  return Math.min(1, Math.log(deltaV / MIN_HIT) / Math.log(MAX_HIT / MIN_HIT))
}

/** 0..1 loudness of a curb or kerb strike from the wheel's compression rate. */
export function curbStrength(compressionRate: number, speed: number): number {
  if (compressionRate < MIN_CURB || speed < 2) return 0
  return Math.min(1, (compressionRate - MIN_CURB) / (MAX_CURB - MIN_CURB)) * Math.min(1, speed / 15)
}

/**
 * Sideways sliding along a wall while touching it, m/s → 0..1 scrape level.
 * It's sliding speed you hear: pinned against a wall at a standstill is silent.
 */
export function scrapeLevel(contactThisTick: boolean, slidingSpeed: number): number {
  if (!contactThisTick || slidingSpeed < 1.5) return 0
  return Math.min(1, (slidingSpeed - 1.5) / 18)
}
