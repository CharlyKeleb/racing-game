/**
 * Time-of-day presets (issue #20). Pure data: Environment turns a preset into
 * a sky, a key light (sun or moon), ambient fill, fog, and an HDR environment
 * map baked from that sky for image-based lighting and reflections.
 */

export type TimeOfDay = 'noon' | 'golden' | 'overcast' | 'night'

export interface TimePreset {
  label: string
  /** Where the sky model puts the sun (degrees). Below 0 the sky goes dark. */
  skySun: { elevation: number; azimuth: number }
  /** Preetham sky parameters (three/examples Sky). */
  sky: { turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number }
  /** Multiplier on the analytic sky, plus a flat colour added on top (overcast grey, night blue). */
  skyExposure: number
  skyTint: [number, number, number]
  /** Clamp on sky radiance so bloom glints instead of flooding the screen (see PR #2). */
  skyMax: number
  /** The shadow-casting light: the sun by day, the moon at night. */
  key: { elevation: number; azimuth: number; color: number; intensity: number; shadows: boolean }
  /** Hemisphere fill: sky colour, ground bounce colour, intensity. */
  fill: { sky: number; ground: number; intensity: number }
  /** Fog colour — matched to the horizon so the streaming edge disappears into it. */
  fog: number
  /** Fraction of the view distance where haze starts (lower = mistier). */
  fogStart: number
  /** Strength of the baked sky environment on PBR materials (reflections, ambient). */
  envIntensity: number
  /** Colour of the ground half of the baked environment (what cars reflect below the horizon). */
  envGround: number
  /** Car headlights on, lenses lit. */
  headlights: boolean
  /**
   * Optional equirectangular .hdr to use instead of the baked sky (e.g. a CC0
   * Poly Haven HDRI in public/environments/). Not shipped: a 2K HDR is 2–6 MB,
   * too heavy for the mobile budget, and the baked sky matches the sun exactly.
   */
  hdri?: string
}

export const TIME_PRESETS: Record<TimeOfDay, TimePreset> = {
  noon: {
    label: 'Noon',
    skySun: { elevation: 58, azimuth: 150 },
    sky: { turbidity: 4, rayleigh: 1.2, mieCoefficient: 0.003, mieDirectionalG: 0.8 },
    skyExposure: 1,
    skyTint: [0, 0, 0],
    skyMax: 1.6,
    key: { elevation: 58, azimuth: 150, color: 0xfff6ea, intensity: 2.8, shadows: true },
    fill: { sky: 0xcfe3ff, ground: 0x4f6a3a, intensity: 0.55 },
    fog: 0xc4d8ea,
    fogStart: 0.45,
    envIntensity: 0.55,
    envGround: 0x3d4a33,
    headlights: false,
  },
  golden: {
    label: 'Golden hour',
    skySun: { elevation: 7, azimuth: 250 },
    sky: { turbidity: 8, rayleigh: 2.6, mieCoefficient: 0.006, mieDirectionalG: 0.86 },
    skyExposure: 1,
    skyTint: [0, 0, 0],
    skyMax: 1.6,
    key: { elevation: 9, azimuth: 250, color: 0xffb06a, intensity: 2.4, shadows: true },
    fill: { sky: 0xffd2a8, ground: 0x3a2e1f, intensity: 0.45 },
    fog: 0xe9b88e,
    fogStart: 0.4,
    envIntensity: 0.65,
    envGround: 0x3b2d1f,
    headlights: false,
  },
  overcast: {
    label: 'Overcast',
    skySun: { elevation: 40, azimuth: 150 },
    sky: { turbidity: 20, rayleigh: 0.3, mieCoefficient: 0.02, mieDirectionalG: 0.5 },
    // The clear-sky model can't do cloud cover: dim it right down and lay a flat grey over it.
    skyExposure: 0.12,
    skyTint: [0.42, 0.45, 0.49],
    skyMax: 1.2,
    key: { elevation: 40, azimuth: 150, color: 0xdfe5ec, intensity: 0.7, shadows: false },
    fill: { sky: 0xd5dbe2, ground: 0x4c5243, intensity: 1.25 },
    fog: 0xaeb4ba,
    fogStart: 0.3,
    envIntensity: 0.85,
    envGround: 0x3c4036,
    headlights: false,
  },
  night: {
    label: 'Night',
    skySun: { elevation: -14, azimuth: 250 },
    sky: { turbidity: 2, rayleigh: 0.5, mieCoefficient: 0.002, mieDirectionalG: 0.8 },
    skyExposure: 0,
    skyTint: [0.006, 0.01, 0.026],
    skyMax: 1,
    // Moonlight: dim, blue, still casts shadows.
    key: { elevation: 38, azimuth: 120, color: 0x9fb6ff, intensity: 0.28, shadows: true },
    fill: { sky: 0x22304f, ground: 0x07090e, intensity: 0.45 },
    fog: 0x070b14,
    fogStart: 0.35,
    envIntensity: 0.35,
    envGround: 0x05070a,
    headlights: true,
  },
}

export const TIME_OF_DAY_ORDER: TimeOfDay[] = ['noon', 'golden', 'overcast', 'night']

export function isTimeOfDay(v: unknown): v is TimeOfDay {
  return typeof v === 'string' && v in TIME_PRESETS
}
