import type { AiDifficulty } from './AiProfiles'

/**
 * Career: a ladder of events you climb from the bottom rung to the summit, in the Audi
 * RS6-R and the Nissan Skyline only. Each event opens the ones it links to on the rung
 * above, so the ladder is a maze: routes branch, merge and dead-end, and only some reach
 * the top. Pure data and rules (no React, no engine): the Game launches events and
 * reports results; careerStore keeps what you've won.
 */

export type CareerEventKind = 'race' | 'elimination' | 'timeTrial'
export type CareerCar = 'rs6r' | 'r33'

export interface CareerEvent {
  id: string
  name: string
  kind: CareerEventKind
  /** 0 is the bottom rung. */
  rung: number
  /** Column on the ladder, 0..2 (left to right). */
  column: number
  track: string
  car: CareerCar
  laps: number
  /** Rivals on the grid (none in a time trial). */
  rivals: number
  difficulty: AiDifficulty
  /** Race: the worst finish that still wins the event (1 = you must win). */
  maxPosition?: number
  /** Time trial: a valid lap at or under this, ms. */
  targetMs?: number
  /** Events this one opens on the rung above. Empty: a dead end. */
  next: string[]
}

/**
 * Time trial targets are the AI's own best lap at that difficulty, in the same car on the
 * same circuit (measured with the race physics, 3 laps). From Mythic up the AI's car also
 * carries its edge (RIVAL_EDGE), so those laps are faster than a stock car should manage.
 */
const AI_LAP_MS = {
  'u2city/r33/legend': 51300,
  'canyon/rs6r/legend': 78100,
  'paris/r33/mythic': 60383,
  'nurburgring/rs6r/impossible': 111233,
  'singapore/r33/impossible': 106467,
} as const

/** Elimination: one car goes out at the end of every lap, so it runs a lap per rival. */
function elimination(e: Omit<CareerEvent, 'kind' | 'laps'>): CareerEvent {
  return { ...e, kind: 'elimination', laps: e.rivals + 1 }
}

export const CAREER: readonly CareerEvent[] = [
  // Rung 1: Street rookie
  { id: 'paris-sprint', name: 'Paris Sprint', kind: 'race', rung: 0, column: 0, track: 'paris', car: 'rs6r', laps: 2, rivals: 3, difficulty: 'legend', maxPosition: 1, next: ['first-cut', 'marina-shakedown'] },
  { id: 'bayview-hotlap', name: 'Bayview Hot Lap', kind: 'timeTrial', rung: 0, column: 2, track: 'u2city', car: 'r33', laps: 3, rivals: 0, difficulty: 'legend', targetMs: AI_LAP_MS['u2city/r33/legend'], next: ['marina-shakedown', 'dam-run'] },
  // Rung 2
  elimination({ id: 'first-cut', name: 'First Cut', rung: 1, column: 0, track: 'u2city', car: 'rs6r', rivals: 3, difficulty: 'legend', next: ['ring-debut'] }),
  { id: 'marina-shakedown', name: 'Marina Shakedown', kind: 'race', rung: 1, column: 1, track: 'singapore', car: 'r33', laps: 2, rivals: 3, difficulty: 'legend', maxPosition: 1, next: ['ring-debut', 'paris-knockout'] },
  { id: 'dam-run', name: 'Dam Run', kind: 'timeTrial', rung: 1, column: 2, track: 'canyon', car: 'rs6r', laps: 3, rivals: 0, difficulty: 'legend', targetMs: AI_LAP_MS['canyon/rs6r/legend'], next: [] },
  // Rung 3
  { id: 'ring-debut', name: 'Ring Debut', kind: 'race', rung: 2, column: 1, track: 'nurburgring', car: 'rs6r', laps: 2, rivals: 3, difficulty: 'mythic', maxPosition: 1, next: ['paris-midnight', 'marina-cut'] },
  elimination({ id: 'paris-knockout', name: 'Paris Knockout', rung: 2, column: 2, track: 'paris', car: 'r33', rivals: 3, difficulty: 'mythic', next: ['marina-cut', 'canyon-duel'] }),
  // Rung 4
  { id: 'paris-midnight', name: 'Paris at Midnight', kind: 'timeTrial', rung: 3, column: 0, track: 'paris', car: 'r33', laps: 3, rivals: 0, difficulty: 'mythic', targetMs: AI_LAP_MS['paris/r33/mythic'], next: ['bayview-eight'] },
  elimination({ id: 'marina-cut', name: 'Marina Cut', rung: 3, column: 1, track: 'singapore', car: 'rs6r', rivals: 3, difficulty: 'mythic', next: ['bayview-eight', 'ring-ghost'] }),
  { id: 'canyon-duel', name: 'Canyon Duel', kind: 'race', rung: 3, column: 2, track: 'canyon', car: 'r33', laps: 3, rivals: 1, difficulty: 'impossible', maxPosition: 1, next: ['ring-ghost'] },
  // Rung 5
  { id: 'bayview-eight', name: 'Bayview Eight', kind: 'race', rung: 4, column: 0, track: 'u2city', car: 'rs6r', laps: 3, rivals: 7, difficulty: 'mythic', maxPosition: 1, next: ['marina-ghost', 'last-stand'] },
  { id: 'ring-ghost', name: 'Ring Ghost', kind: 'timeTrial', rung: 4, column: 2, track: 'nurburgring', car: 'rs6r', laps: 3, rivals: 0, difficulty: 'impossible', targetMs: AI_LAP_MS['nurburgring/rs6r/impossible'], next: ['last-stand'] },
  // Rung 6
  { id: 'marina-ghost', name: 'Marina Ghost', kind: 'timeTrial', rung: 5, column: 0, track: 'singapore', car: 'r33', laps: 3, rivals: 0, difficulty: 'impossible', targetMs: AI_LAP_MS['singapore/r33/impossible'], next: [] },
  elimination({ id: 'last-stand', name: 'Last Stand', rung: 5, column: 1, track: 'nurburgring', car: 'r33', rivals: 3, difficulty: 'impossible', next: ['summit'] }),
  // Summit
  { id: 'summit', name: 'The Summit', kind: 'race', rung: 6, column: 1, track: 'singapore', car: 'r33', laps: 3, rivals: 7, difficulty: 'impossible', maxPosition: 1, next: [] },
]

export const CAREER_RUNGS = Math.max(...CAREER.map((e) => e.rung)) + 1
export const SUMMIT = 'summit'

export function careerEvent(id: string): CareerEvent | undefined {
  return CAREER.find((e) => e.id === id)
}

export type CareerStatus = 'won' | 'open' | 'locked'

/** An event is open when it's on the bottom rung, or an event you've won links to it. */
export function careerStatus(id: string, won: ReadonlySet<string>): CareerStatus {
  if (won.has(id)) return 'won'
  const event = careerEvent(id)
  if (!event) return 'locked'
  if (event.rung === 0) return 'open'
  return CAREER.some((e) => won.has(e.id) && e.next.includes(id)) ? 'open' : 'locked'
}

/** What a finished event produced, from the Game. */
export type CareerOutcome =
  | { kind: 'race'; position: number; field: number }
  | { kind: 'elimination'; eliminated: boolean; lap: number }
  | { kind: 'timeTrial'; bestLapMs: number | null }

/** Did this outcome win the event? */
export function careerPassed(event: CareerEvent, outcome: CareerOutcome): boolean {
  switch (outcome.kind) {
    case 'race': return outcome.position <= (event.maxPosition ?? 1)
    case 'elimination': return !outcome.eliminated
    case 'timeTrial': return outcome.bestLapMs !== null && outcome.bestLapMs <= (event.targetMs ?? 0)
  }
}

/**
 * Elimination: which car goes out now. Called when the leader has just started `leaderLap`;
 * one car goes out per completed lap of the leader, so after lap k there are k out.
 * `order` is the current running order (ids, leader first) of the cars still in.
 * @returns the id to knock out, or null when nobody is due.
 */
export function eliminationDue(order: readonly number[], leaderLap: number, eliminated: number): number | null {
  if (order.length < 2) return null
  return leaderLap - 1 > eliminated ? order[order.length - 1] : null
}

/** Lap time as m:ss.t, for targets. */
export function formatLap(ms: number): string {
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
