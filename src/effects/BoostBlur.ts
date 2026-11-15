import * as THREE from 'three'
import type { QualityPreset } from '../stores/gameStore'

/**
 * Nitro zoom blur: while the boost burns, the frame smears outward from the
 * vanishing point, the way NFS-style racers (and Project Endurance) sell the
 * kick. The middle of the frame, where the car and the road ahead are, stays
 * sharp; the smear grows toward the edges. Shared by the WebGL effect in
 * effects/PostFX.ts and the WebGPU node twin in engine/nodes/postfx.ts.
 */

/** Where the smear converges, in UV (0,0 bottom-left): a little above centre, near the horizon. */
export const BOOST_BLUR_CENTER = new THREE.Vector2(0.5, 0.56)
/** Longest smear at full strength, as a share of the distance to the centre. */
export const BOOST_BLUR_SPREAD = 0.11
/** Sharp radius and full-smear radius, in half-heights from the centre (aspect corrected). */
export const BOOST_BLUR_INNER = 0.22
export const BOOST_BLUR_OUTER = 0.95

/** Samples per pixel by preset. */
export function boostBlurSamples(quality: QualityPreset): number {
  return quality === 'low' ? 6 : quality === 'medium' ? 9 : 12
}

/**
 * Target strength, 0..~1.25: the boost (above 1 in a perfect boost) scaled by
 * speed (none below 50 km/h, full from 140) and the Motion blur setting, so
 * turning blur off (reduced motion) turns this off too. Pure.
 */
export function boostBlurTarget(intensity: number, speedKmh: number, blurAmount: number): number {
  if (!(intensity > 0) || !(blurAmount > 0) || !Number.isFinite(speedKmh)) return 0
  const speed = THREE.MathUtils.smoothstep(Math.abs(speedKmh), 50, 140)
  return Math.min(1.25, intensity) * speed * Math.min(1, blurAmount / 0.5)
}

/** Follows the target: snaps in with the ignition, eases out as the boost ends. Pure. */
export function stepBoostBlur(current: number, target: number, dt: number): number {
  if (!(dt > 0)) return current
  const rate = target > current ? 9 : 3
  const next = current + (target - current) * (1 - Math.exp(-rate * dt))
  return next < 0.002 ? 0 : next
}
