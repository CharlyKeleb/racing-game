import type { CarBuild } from '../vehicles/CarBuild'
import { noteLocalSave } from '../stores/accountStore'

/**
 * Time Trial timing (#31): checkpoint splits against your best valid lap, lap
 * validity and personal bests per circuit, car and performance build. Pure
 * apart from the small localStorage helpers at the bottom; fed with fixed-tick
 * lap times by Game.
 */

export interface TrialLap {
  lapMs: number
  /** Lap time at each checkpoint, by checkpoint index (index 0, the line, unused). */
  splits: number[]
}

export type InvalidReason = 'reset' | 'missed'

export interface LapResult {
  lapMs: number
  valid: boolean
  /** Fastest valid lap this session. */
  sessionBest: boolean
  /** Beat the stored personal best for this circuit, car and build. */
  personalBest: boolean
  /** Against the reference (personal best) at the line; null without one. */
  deltaMs: number | null
}

export class TimeTrialSession {
  /** Splits of the lap being driven. */
  readonly splits: number[] = []
  valid = true
  invalidReason: InvalidReason | null = null
  sessionBest: TrialLap | null = null
  personalBest: TrialLap | null = null
  /** Laps completed this session, valid or not. */
  readonly laps: { lapMs: number; valid: boolean }[] = []
  /** Checkpoint index of the last split (0 = the line) and its delta to the reference, ms. */
  lastSplitIndex = -1
  lastSplitMs = 0
  lastDeltaMs: number | null = null
  lastLap: LapResult | null = null

  /** New session with the stored personal best as the reference. */
  start(personalBest: TrialLap | null): void {
    this.personalBest = personalBest
    this.sessionBest = null
    this.laps.length = 0
    this.lastLap = null
    this.restartLap()
  }

  /** Back to a fresh lap (quick restart, or after crossing the line). */
  restartLap(): void {
    this.splits.length = 0
    this.valid = true
    this.invalidReason = null
    this.lastSplitIndex = -1
    this.lastSplitMs = 0
    this.lastDeltaMs = null
  }

  /** The lap being driven no longer counts (reset to a checkpoint, missed a gate). */
  invalidate(reason: InvalidReason): void {
    if (!this.valid) return
    this.valid = false
    this.invalidReason = reason
  }

  /** The lap a split is compared with: the personal best (never slower than this session's best). */
  get reference(): TrialLap | null {
    return this.personalBest
  }

  /** Passed checkpoint `index` (1..n-1) at `lapMs` into the lap. Returns the delta to the reference, ms. */
  checkpoint(index: number, lapMs: number): number | null {
    this.splits[index] = lapMs
    const ref = this.reference?.splits[index]
    this.lastSplitIndex = index
    this.lastSplitMs = lapMs
    this.lastDeltaMs = ref === undefined ? null : lapMs - ref
    return this.lastDeltaMs
  }

  /** Crossed the line. Invalid laps are timed but never become a best. */
  completeLap(lapMs: number): LapResult {
    const ref = this.reference
    const deltaMs = ref ? lapMs - ref.lapMs : null
    const valid = this.valid
    const lap: TrialLap = { lapMs, splits: this.splits.slice() }
    const sessionBest = valid && (!this.sessionBest || lapMs < this.sessionBest.lapMs)
    const personalBest = valid && (!this.personalBest || lapMs < this.personalBest.lapMs)
    if (sessionBest) this.sessionBest = lap
    if (personalBest) this.personalBest = lap
    this.laps.push({ lapMs, valid })
    this.lastLap = { lapMs, valid, sessionBest, personalBest, deltaMs }
    this.restartLap()
    this.lastSplitIndex = 0
    this.lastSplitMs = lapMs
    this.lastDeltaMs = valid ? deltaMs : null
    return this.lastLap
  }

  get validLaps(): number {
    return this.laps.reduce((n, lap) => n + (lap.valid ? 1 : 0), 0)
  }
}

/** Performance parts only: paint, wheels and spoilers don't change a lap time. */
export function trialBuildKey(build: Pick<CarBuild, 'engine' | 'tires' | 'suspension' | 'weight' | 'brakes'>): string {
  return `e${build.engine}-t${build.tires}-s${build.suspension}-w${build.weight}-b${build.brakes}`
}

function storageKey(track: string, car: string, buildKey: string): string {
  return `racing-game:trial:${track}:${car}:${buildKey}:v1`
}

export function readTrialRecord(track: string, car: string, buildKey: string): TrialLap | null {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(track, car, buildKey)) ?? 'null') as Partial<TrialLap> | null
    if (!raw || typeof raw.lapMs !== 'number' || !Number.isFinite(raw.lapMs) || raw.lapMs <= 0) return null
    const splits = Array.isArray(raw.splits) ? raw.splits.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)) : []
    return { lapMs: raw.lapMs, splits: splits as number[] }
  } catch {
    return null
  }
}

export function saveTrialRecord(track: string, car: string, buildKey: string, lap: TrialLap): void {
  try {
    localStorage.setItem(storageKey(track, car, buildKey), JSON.stringify(lap))
    noteLocalSave()
  } catch {
    // Private browsing: the session still runs, the best just won't persist.
  }
}
