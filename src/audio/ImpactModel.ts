/**
 * How a hit sounds, from what happened: numbers in, numbers out (ImpactSound
 * plays the result). Pure, so the thresholds are tested.
 *
 *   car     body panels meeting: a hollow thud, a metallic crunch, the panels
 *           ringing, and on a big one plastic and glass going
 *   wall    concrete or armco: a heavier, deader thud and a lower crunch
 *   ground  bottoming out or landing: a deep thump and a short scrape
 *   curb    a wheel striking a raised kerb or city curb: a tyre-and-rim thunk
 */
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

export interface ImpactLayers {
  /** Low body thud: start pitch, Hz, level 0..1 and decay, s. */
  thudHz: number
  thud: number
  thudDecay: number
  /** Metallic crunch: band centre, Hz, level and decay. */
  crunchHz: number
  crunch: number
  crunchDecay: number
  /** Panel ring (inharmonic partials), level 0..1. */
  ring: number
  /** Plastic and glass going, level 0..1 (only on big hits). */
  debris: number
}

/** The layers for one hit: the kind sets the character, strength scales and lengthens it. */
export function impactLayers(kind: ImpactKind, strength: number): ImpactLayers {
  const s = Math.max(0, Math.min(1, strength))
  const big = Math.max(0, (s - 0.55) / 0.45)
  switch (kind) {
    case 'car':
      return { thudHz: 110, thud: 0.6 + 0.4 * s, thudDecay: 0.18 + 0.2 * s, crunchHz: 2200, crunch: s, crunchDecay: 0.1 + 0.3 * s, ring: 0.3 + 0.7 * s, debris: big }
    case 'wall':
      return { thudHz: 75, thud: 0.8 + 0.2 * s, thudDecay: 0.22 + 0.25 * s, crunchHz: 1300, crunch: 0.8 * s, crunchDecay: 0.08 + 0.3 * s, ring: 0.15 * s, debris: big * 0.8 }
    case 'ground':
      return { thudHz: 60, thud: 1, thudDecay: 0.25 + 0.2 * s, crunchHz: 700, crunch: 0.35 * s, crunchDecay: 0.12, ring: 0, debris: 0 }
    case 'curb':
      return { thudHz: 95, thud: 0.9, thudDecay: 0.09 + 0.06 * s, crunchHz: 1800, crunch: 0.15 * s, crunchDecay: 0.03, ring: 0.1 * s, debris: 0 }
  }
}
