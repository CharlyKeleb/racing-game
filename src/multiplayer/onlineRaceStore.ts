import { createStore } from 'zustand/vanilla'
import type { Standing } from '../racing/RaceStandings'
export const onlineRaceStore = createStore<{
  resultsOpen: boolean; finished: boolean; active: boolean; loaded: boolean; menuOpen: boolean; delayed: boolean
  speedKmh: number; rpm: number; redlineRpm: number; gear: number; nitro: number; nitroActive: boolean; countdown: number | null
  /** Lights out within the last 0.9 s: the gantry shows Go, as offline. */
  go: boolean
  lap: number; totalLaps: number; currentLapMs: number; bestLapMs: number | null; standings: Standing[]
  /** Time left before the server closes the race, once a rival has finished and this racer hasn't. */
  finishWindowMs: number | null
}>()(() => ({ resultsOpen: false, finished: false, active: false, loaded: false, menuOpen: false, delayed: false, speedKmh: 0, rpm: 900, redlineRpm: 7000, gear: 1, nitro: 0, nitroActive: false, countdown: null,
  go: false, lap: 1, totalLaps: 1, currentLapMs: 0, bestLapMs: null, standings: [], finishWindowMs: null }))
export const RELEASED_ONLINE_INPUT = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false })
