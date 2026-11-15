export type AiDifficulty = 'legend' | 'mythic' | 'impossible'
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
/** Planning shares of tire grip, before personality and pace; vehicle physics is unchanged. */
export const AI_DIFFICULTIES = {
  legend: { label: 'Legend', description: 'Flat-out rivals with an edge in power and grip. They brake at the limit, never ease off and hunt you down. Winning takes a perfect race.', pace: 1.13, cornerGripShare: 0.97, brakeGripShare: 0.95, reaction: 0.02, variation: 0 },
  mythic: { label: 'Mythic', description: 'Legend, turned up. Rivals run stronger cars, carry more speed through every bend and close any gap twice as fast. Expect to be chased the whole race.', pace: 1.17, cornerGripShare: 0.98, brakeGripShare: 0.96, reaction: 0.016, variation: 0 },
  impossible: { label: 'Impossible', description: 'Rivals in cars far beyond stock, driving on the edge of grip with instant reactions. Any slip and they are gone. Built to be beaten by almost nobody.', pace: 1.21, cornerGripShare: 0.98, brakeGripShare: 0.97, reaction: 0.012, variation: 0 },
} as const

export interface CarEdge { torque: number; grip: number; brakes: number }
/**
 * Rivals' cars carry an edge over stock: more torque, grip and brakes. With the catch-up
 * below, a single mistake loses the race.
 */
export const RIVAL_EDGE: Record<AiDifficulty, CarEdge> = {
  legend: { torque: 1.14, grip: 1.05, brakes: 1.12 },
  mythic: { torque: 1.24, grip: 1.08, brakes: 1.18 },
  impossible: { torque: 1.36, grip: 1.12, brakes: 1.25 },
}

/**
 * Catch-up per difficulty: a rival behind the player asks for up to `catchUp` more pace,
 * reaching it `metres` back; one ahead eases by at most `easeOff` (none do).
 */
export const CATCH_UP: Record<AiDifficulty, { catchUp: number; metres: number; easeOff: number }> = {
  legend: { catchUp: 0.16, metres: 160, easeOff: 0 },
  mythic: { catchUp: 0.22, metres: 140, easeOff: 0 },
  impossible: { catchUp: 0.3, metres: 120, easeOff: 0 },
}
export function isAiDifficulty(value: unknown): value is AiDifficulty {
  return typeof value === 'string' && Object.hasOwn(AI_DIFFICULTIES, value)
}
