import { createStore } from 'zustand/vanilla'

/**
 * High-frequency values for the HUD. The engine publishes at a throttled rate
 * (see Game.publishTelemetry) so React never re-renders at physics rate.
 */
export interface Telemetry {
  speedKmh: number
  rpm: number
  redlineRpm: number
  gear: number
  /** Nitro tank, 0..1. */
  nitro: number
  nitroActive: boolean
  /** Enough in the tank to start a boost. */
  nitroReady: boolean
  lap: number
  totalLaps: number
  currentLapMs: number
  lastLapMs: number | null
  bestLapMs: number | null
  totalMs: number
  countdown: number
  fps: number
}

export const initialTelemetry: Telemetry = {
  speedKmh: 0,
  rpm: 0,
  redlineRpm: 8000,
  gear: 1,
  nitro: 0,
  nitroActive: false,
  nitroReady: false,
  lap: 0,
  totalLaps: 3,
  currentLapMs: 0,
  lastLapMs: null,
  bestLapMs: null,
  totalMs: 0,
  countdown: 0,
  fps: 0,
}

export const telemetryStore = createStore<Telemetry>()(() => initialTelemetry)
