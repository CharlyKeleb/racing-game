/**
 * What a tire is standing on. Pure data so the tire model, the effects and a
 * future multiplayer server agree. Codes match scripts/track/derive-from-chunks.mjs.
 */
export const Surface = {
  /** Off the mapped area: open terrain, treated like grass. */
  None: 0,
  Asphalt: 1,
  Kerb: 2,
  Grass: 3,
  /** Gravel-trap sand. */
  Sand: 4,
  Gravel: 5,
} as const
export type Surface = (typeof Surface)[keyof typeof Surface]

export interface SurfaceProps {
  /** Multiplier on the tire's peak friction. */
  grip: number
  /**
   * Extra rolling resistance coefficient (× wheel load). Loose surfaces drag
   * hard: tires plough into sand, which is the whole point of a gravel trap.
   */
  drag: number
  /** 0..1, how much loose material a moving tire throws up (sand spray, dust). */
  loose: number
}

/**
 * Roughly real friction ratios against dry asphalt (μ ≈ 1.0–1.2 for road tires):
 * dry grass ≈ 0.5, loose sand / gravel ≈ 0.5 with very high rolling drag — a
 * car coasting in at 100 km/h is stopped within ~80 m of trap.
 */
export const SURFACE_PROPS: Record<Surface, SurfaceProps> = {
  [Surface.None]: { grip: 0.55, drag: 0.05, loose: 0.25 },
  [Surface.Asphalt]: { grip: 1, drag: 0, loose: 0 },
  [Surface.Kerb]: { grip: 0.88, drag: 0.004, loose: 0 },
  [Surface.Grass]: { grip: 0.55, drag: 0.05, loose: 0.25 },
  [Surface.Sand]: { grip: 0.5, drag: 0.5, loose: 1 },
  [Surface.Gravel]: { grip: 0.55, drag: 0.4, loose: 0.8 },
}

export function surfaceProps(s: number): SurfaceProps {
  return SURFACE_PROPS[s as Surface] ?? SURFACE_PROPS[Surface.Asphalt]
}
