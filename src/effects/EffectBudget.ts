import type { QualityPreset } from '../stores/gameStore'

/** Initial quality caps, not measured device performance guarantees. */
export const EFFECT_BUDGET = {
  low: { smoke: 160, grains: 360, sheet: 100, dust: 160, emission: .4, cloudSize: .65 },
  medium: { smoke: 360, grains: 800, sheet: 260, dust: 360, emission: .7, cloudSize: .85 },
  high: { smoke: 640, grains: 1500, sheet: 500, dust: 720, emission: 1, cloudSize: 1 },
} satisfies Record<QualityPreset, { smoke: number; grains: number; sheet: number; dust: number; emission: number; cloudSize: number }>
