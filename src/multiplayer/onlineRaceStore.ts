import { createStore } from 'zustand/vanilla'
export const onlineRaceStore = createStore<{
  active: boolean; loaded: boolean; menuOpen: boolean; delayed: boolean
  speedKmh: number; rpm: number; gear: number; nitro: number; countdown: number | null
}>()(() => ({ active: false, loaded: false, menuOpen: false, delayed: false, speedKmh: 0, rpm: 900, gear: 1, nitro: 0, countdown: null }))
export const RELEASED_ONLINE_INPUT = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false })
