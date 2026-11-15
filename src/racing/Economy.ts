import type { AiDifficulty } from './AiProfiles'
/**
 * Coins: what a race pays and what a car costs. Pure (numbers in, numbers out) so it's unit
 * tested and can move to a server that pays out trusted results.
 *
 * Scarce on purpose. A 3-lap win against Legend rivals pays ~500, a mid-field finish ~250
 * (Mythic and Impossible pay more), and the dearest car costs 30,000: about sixty wins. Past DAILY_SOFT_CAP coins in a day, races pay a quarter, so
 * grinding one track all night doesn't buy the garage.
 */

export type RewardMode = 'quick' | 'timeTrial' | 'drift'

export interface RewardLine {
  label: string
  coins: number
}

export interface QuickRaceResult {
  mode: 'quick'
  /** 1-based finishing position, and how many started. */
  position: number
  field: number
  laps: number
  /** Your best lap this race, and your best ever on this track (null: first time here). */
  bestLapMs: number | null
  previousBestLapMs: number | null
  difficulty: AiDifficulty
}

export interface TrialResult {
  mode: 'timeTrial'
  validLaps: number
  bestLapMs: number | null
  previousBestLapMs: number | null
}

export interface DriftResult {
  mode: 'drift'
  score: number
  /** 0 none, 1 bronze, 2 silver, 3 gold. */
  medal: 0 | 1 | 2 | 3
}

export type RaceResult = QuickRaceResult | TrialResult | DriftResult

export const DAILY_SOFT_CAP = 2000
/** Share of a payout over the daily soft cap. */
export const OVER_CAP_RATE = 0.25
/** Coins a new player starts with. */
export const STARTING_COINS = 500

const FINISH = 60
const PER_LAP = 20
const PODIUM = [150, 80, 40]
const DIFFICULTY: Record<AiDifficulty, number> = { legend: 2, mythic: 2.6, impossible: 3.5 }
const LAP_RECORD = 75
const FIRST_LAP_RECORD = 25
const TRIAL_PER_LAP = 15
const TRIAL_LAP_CAP = 10
const DRIFT_PER_POINTS = 1500
const DRIFT_SCORE_CAP = 150
const DRIFT_MEDAL = [0, 30, 60, 100]

/** Itemised payout for a finished race, before the daily cap. */
export function raceReward(r: RaceResult): RewardLine[] {
  const lines: RewardLine[] = []
  const lapRecord = (best: number | null, previous: number | null) => {
    if (best === null) return
    if (previous === null) lines.push({ label: 'First lap time set', coins: FIRST_LAP_RECORD })
    else if (best < previous) lines.push({ label: 'New lap record', coins: LAP_RECORD })
  }
  if (r.mode === 'quick') {
    // Finish and podium pay grow with the race up to 3 laps, so sprinting 1-lap races isn't the farm.
    const rate = DIFFICULTY[r.difficulty], length = Math.min(1, r.laps / 3)
    lines.push({ label: 'Race finished', coins: Math.round(FINISH * rate * length) })
    lines.push({ label: `${r.laps} ${r.laps === 1 ? 'lap' : 'laps'} completed`, coins: Math.round(PER_LAP * r.laps * rate) })
    // Podium pay needs a field: a solo run has nobody to beat. Smaller fields pay less.
    const podium = r.field > 1 ? PODIUM[r.position - 1] : undefined
    if (podium) lines.push({ label: r.position === 1 ? 'Victory' : `P${r.position} podium`, coins: Math.round(podium * rate * length * Math.min(1, r.field / 4)) })
    lapRecord(r.bestLapMs, r.previousBestLapMs)
  } else if (r.mode === 'timeTrial') {
    const laps = Math.min(TRIAL_LAP_CAP, r.validLaps)
    if (laps) lines.push({ label: `${laps} clean ${laps === 1 ? 'lap' : 'laps'}`, coins: laps * TRIAL_PER_LAP })
    lapRecord(r.bestLapMs, r.previousBestLapMs)
  } else {
    const points = Math.min(DRIFT_SCORE_CAP, Math.floor(r.score / DRIFT_PER_POINTS))
    if (points) lines.push({ label: 'Drift points', coins: points })
    if (r.medal) lines.push({ label: `${['', 'Bronze', 'Silver', 'Gold'][r.medal]} medal`, coins: DRIFT_MEDAL[r.medal] })
  }
  return lines.filter(l => l.coins > 0)
}

/** What actually gets paid of `amount`, with `earnedToday` already paid today. */
export function capPayout(amount: number, earnedToday: number): number {
  const full = Math.max(0, Math.min(amount, DAILY_SOFT_CAP - earnedToday))
  return full + Math.floor((amount - full) * OVER_CAP_RATE)
}

/**
 * Car prices in coins. Owned from the start: PRICE 0. Unlisted cars cost nothing (placeholders).
 * Every car is free but the two hypercars you earn: the Dodge Ice Charger and the Koenigsegg.
 */
export const CAR_PRICES: Readonly<Record<string, number>> = {
  porsche911: 0,
  bmw: 0,
  amg: 0,
  diablo: 0,
  charger: 12000,
  koenigsegg: 30000,
  g63: 0,
  r33: 0,
  rs6r: 0,
  gt3rs: 0,
  demon: 0,
}

export function carPrice(id: string): number {
  return CAR_PRICES[id] ?? 0
}

/** Cars every new player owns. */
export const STARTER_CARS: readonly string[] = Object.entries(CAR_PRICES).filter(([, price]) => price === 0).map(([id]) => id)
