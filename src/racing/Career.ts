import type { AiDifficulty } from './AiProfiles'

/**
 * Career: a ladder you climb one step at a time, in the Audi RS6-R and the Nissan Skyline
 * only. One event is open: win it and the next one opens. The steps snake up a 3-wide
 * board (left to right on one rung, up, right to left on the next), from Legend at the
 * bottom through Mythic to Impossible at The Summit. Pure data and rules (no React, no
 * engine): the Game launches events and reports results; careerStore keeps what you've won.
 */

export type CareerEventKind = 'race' | 'elimination' | 'timeTrial'
export type CareerCar = 'rs6r' | 'r33'

interface CareerEventSpec {
  id: string
  name: string
  kind: CareerEventKind
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
}

export interface CareerEvent extends CareerEventSpec {
  /** Place in the climb, 0 first. */
  step: number
  /** Board cell: rung 0 is the bottom; column 0..2, left to right. */
  rung: number
  column: number
}

/** Steps per rung of the board. */
export const CAREER_WIDTH = 3

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
function elimination(e: Omit<CareerEventSpec, 'kind' | 'laps'>): CareerEventSpec {
  return { ...e, kind: 'elimination', laps: e.rivals + 1 }
}

/** The climb, bottom to top. */
const STEPS: CareerEventSpec[] = [
  // Legend
  { id: 'paris-sprint', name: 'Paris Sprint', kind: 'race', track: 'paris', car: 'rs6r', laps: 2, rivals: 3, difficulty: 'legend', maxPosition: 1 },
  { id: 'bayview-hotlap', name: 'Bayview Hot Lap', kind: 'timeTrial', track: 'u2city', car: 'r33', laps: 3, rivals: 0, difficulty: 'legend', targetMs: AI_LAP_MS['u2city/r33/legend'] },
  elimination({ id: 'first-cut', name: 'First Cut', track: 'u2city', car: 'rs6r', rivals: 3, difficulty: 'legend' }),
  { id: 'marina-shakedown', name: 'Marina Shakedown', kind: 'race', track: 'singapore', car: 'r33', laps: 2, rivals: 3, difficulty: 'legend', maxPosition: 1 },
  { id: 'dam-run', name: 'Dam Run', kind: 'timeTrial', track: 'canyon', car: 'rs6r', laps: 3, rivals: 0, difficulty: 'legend', targetMs: AI_LAP_MS['canyon/rs6r/legend'] },
  // Mythic
  { id: 'ring-debut', name: 'Ring Debut', kind: 'race', track: 'nurburgring', car: 'rs6r', laps: 2, rivals: 3, difficulty: 'mythic', maxPosition: 1 },
  elimination({ id: 'paris-knockout', name: 'Paris Knockout', track: 'paris', car: 'r33', rivals: 3, difficulty: 'mythic' }),
  { id: 'paris-midnight', name: 'Paris at Midnight', kind: 'timeTrial', track: 'paris', car: 'r33', laps: 3, rivals: 0, difficulty: 'mythic', targetMs: AI_LAP_MS['paris/r33/mythic'] },
  elimination({ id: 'marina-cut', name: 'Marina Cut', track: 'singapore', car: 'rs6r', rivals: 3, difficulty: 'mythic' }),
  { id: 'bayview-eight', name: 'Bayview Eight', kind: 'race', track: 'u2city', car: 'rs6r', laps: 3, rivals: 7, difficulty: 'mythic', maxPosition: 1 },
  // Impossible
  { id: 'canyon-duel', name: 'Canyon Duel', kind: 'race', track: 'canyon', car: 'r33', laps: 3, rivals: 1, difficulty: 'impossible', maxPosition: 1 },
  { id: 'ring-ghost', name: 'Ring Ghost', kind: 'timeTrial', track: 'nurburgring', car: 'rs6r', laps: 3, rivals: 0, difficulty: 'impossible', targetMs: AI_LAP_MS['nurburgring/rs6r/impossible'] },
  { id: 'marina-ghost', name: 'Marina Ghost', kind: 'timeTrial', track: 'singapore', car: 'r33', laps: 3, rivals: 0, difficulty: 'impossible', targetMs: AI_LAP_MS['singapore/r33/impossible'] },
  elimination({ id: 'last-stand', name: 'Last Stand', track: 'nurburgring', car: 'r33', rivals: 3, difficulty: 'impossible' }),
  { id: 'summit', name: 'The Summit', kind: 'race', track: 'singapore', car: 'r33', laps: 3, rivals: 7, difficulty: 'impossible', maxPosition: 1 },
]

/** Snakes up the board: even rungs run left to right, odd rungs right to left. */
export const CAREER: readonly CareerEvent[] = STEPS.map((e, step) => {
  const rung = Math.floor(step / CAREER_WIDTH), along = step % CAREER_WIDTH
  return { ...e, step, rung, column: rung % 2 === 0 ? along : CAREER_WIDTH - 1 - along }
})

export const CAREER_RUNGS = Math.max(...CAREER.map((e) => e.rung)) + 1
export const SUMMIT = 'summit'

export function careerEvent(id: string): CareerEvent | undefined {
  return CAREER.find((e) => e.id === id)
}

export type CareerStatus = 'won' | 'open' | 'locked'

/** One at a time: an event is open once every step below it is won. Won events stay replayable. */
export function careerStatus(id: string, won: ReadonlySet<string>): CareerStatus {
  if (won.has(id)) return 'won'
  const event = careerEvent(id)
  if (!event) return 'locked'
  return CAREER.slice(0, event.step).every((e) => won.has(e.id)) ? 'open' : 'locked'
}

/** The step after this one (undefined at The Summit). */
export function careerNext(id: string): CareerEvent | undefined {
  const event = careerEvent(id)
  return event ? CAREER[event.step + 1] : undefined
}

/** Where you are: the open step, or null once the whole ladder is won. */
export function careerCurrent(won: ReadonlySet<string>): CareerEvent | null {
  return CAREER.find((e) => careerStatus(e.id, won) === 'open') ?? null
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
