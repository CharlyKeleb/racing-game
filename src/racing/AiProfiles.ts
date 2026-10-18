export type AiDifficulty = 'relaxed' | 'challenging' | 'intense'
export interface DriverProfile {
  name: string
  style: 'grip' | 'power' | 'drift'
  corner: number
  straight: number
  braking: number
  boostReserve: number
}
export const DRIVER_PROFILES: readonly DriverProfile[] = [
  { name: 'Raven', style: 'grip', corner: 1, straight: 1, braking: 0.95, boostReserve: 0.3 },
  { name: 'Torque', style: 'power', corner: 0.96, straight: 1.07, braking: 1, boostReserve: 0.45 },
  { name: 'Viper', style: 'drift', corner: 1.04, straight: 1, braking: 1.05, boostReserve: 0.25 },
]
export const AI_DIFFICULTIES = {
  relaxed: { label: 'Relaxed', description: 'Earlier braking, gentler pace and more room for mistakes.', pace: 0.9, braking: 0.85, reaction: 0.12, variation: 0.03 },
  challenging: { label: 'Challenging', description: 'Competitive pace, committed passes and balanced cornering.', pace: 1, braking: 1, reaction: 0.08, variation: 0.015 },
  intense: { label: 'Intense', description: 'Later braking, faster reactions and more consistent rivals.', pace: 1.06, braking: 1.1, reaction: 0.04, variation: 0.004 },
} as const
export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return value === 'relaxed' || value === 'challenging' || value === 'intense'
}
