import type { Standing } from '../racing/RaceStandings'
import { createStore } from 'zustand/vanilla'
import type { Callout } from '../racing/RaceCallouts'
import type { LaunchGrade } from '../racing/LaunchControl'
import type { InvalidReason, LapResult } from '../racing/TimeTrial'

/**
 * High-frequency values for the HUD. The engine publishes at a throttled rate
 * (see Game.publishTelemetry) so React never re-renders at physics rate.
 */
export interface Telemetry {
  finishProgress: number
  /** Real seconds into the finish cinematic (FinishSequence's shot timeline). */
  finishSeconds: number
  /** The short reduced-motion finish: no shots, no badge animation. */
  finishReduced: boolean
  finishPosition: number
  finishFieldSize: number
  introShot: number
  introProgress: number
  /** Who each rival tag names; placement is per frame in rivalTagStore. */
  rivalLabels: { id: number; name: string; style: string; position: number }[]
  opponents: { id: number; x: number; z: number }[]
  standings: Standing[]
  speedKmh: number
  rpm: number
  redlineRpm: number
  gear: number
  /** Nitro tank, 0..1. */
  drafting: number
  nitro: number
  nitroActive: boolean
  /** Enough in the tank to start a boost. */
  nitroReady: boolean
  /** Perfect-nitro timing cue, 0..1 toward the window closing; 0 = nothing to aim for. */
  nitroCue: number
  /** A tap now fires a perfect boost. */
  nitroWindow: boolean
  nitroPerfect: boolean
  /** Just mistimed the perfect tap (flashes briefly). */
  nitroMissed: boolean
  /** Drift under way, and its points so far. */
  driftAngle: number
  driftScoring: boolean
  driftZone: boolean
  driftLink: number
  driftComboProgress: number
  driftMessage: string
  driftBestChain: number
  driftLongest: number
  driftTransitions: number
  driftZoneSeconds: number
  driftPeakCombo: number
  driftBusts: number
  driftPersonalBest: number
  driftNewBest: boolean
  driftTotal: number
  driftCombo: number
  driftChain: number
  driftGate: number
  driftGateCount: number
  driftActive: boolean
  driftScore: number
  /** Points of the drift that just ended, shown briefly; 0 = nothing to show. */
  driftBanked: number
  lap: number
  totalLaps: number
  currentLapMs: number
  lastLapMs: number | null
  bestLapMs: number | null
  totalMs: number
  countdown: number
  /** Start gantry: red lights lit now, out of how many. */
  startLights: number
  startLightCount: number
  /** Grid revs as a share of idle→redline, and the launch target band (#91). */
  launchRevs: number
  launchBandLow: number
  launchBandHigh: number
  /** Launch held on the grid (handbrake / brake). */
  launchArmed: boolean
  launchGrade: LaunchGrade
  /** The PERFECT / GOOD / … call is showing. */
  launchFlash: boolean
  /** Lights out → release, seconds; -1 when the launch wasn't graded on a release. */
  launchReaction: number
  /** Free Roam: no timing, laps or positions. */
  freeRoam: boolean
  /** Time Trial (#31). Lap being driven (1-based), laps done and how many were valid. */
  trialLap: number
  trialLaps: number
  trialValidLaps: number
  trialValid: boolean
  trialInvalidReason: InvalidReason | null
  trialSessionBestMs: number | null
  trialPersonalBestMs: number | null
  /** Last split: checkpoint index (0 = the line, -1 = none yet), lap time there and delta to the PB. */
  trialSplitIndex: number
  trialSplitMs: number
  trialDeltaMs: number | null
  /** The split / lap call is on screen. */
  trialSplitShow: boolean
  trialLastLap: LapResult | null
  /** Gate to drive through next (0 = the line) and how many there are. */
  trialNextGate: number
  trialGateCount: number
  /** The player ended the session (results showing). */
  trialEnded: boolean
  /** Race callout on screen (#90), or null. */
  callout: Callout | null
  fps: number
  /** Car position on the XZ plane and yaw (0 = facing +Z), for the minimap. */
  carX: number
  carZ: number
  heading: number
  /** Nearest centreline point (index into GameState.minimap.points), for the minimap route. */
  trackIndex: number
  /** Meters of racing left to the finish, over all remaining laps. */
  distanceLeft: number
  /** Driving against the race direction for a moment. */
  wrongWay: boolean
  /** Drove on past the next gate without crossing it: the race won't count progress until a reset. */
  missedCheckpoint: boolean
}

export const initialTelemetry: Telemetry = {
  finishProgress: 0,
  finishSeconds: 0,
  finishReduced: false,
  finishPosition: 1,
  finishFieldSize: 1,
  introShot: 0,
  introProgress: 0,
  rivalLabels: [],
  opponents: [],
  standings: [],
  speedKmh: 0,
  rpm: 0,
  redlineRpm: 8000,
  gear: 1,
  drafting: 0,
  nitro: 0,
  nitroActive: false,
  nitroReady: false,
  nitroCue: 0,
  nitroWindow: false,
  nitroPerfect: false,
  nitroMissed: false,
  driftAngle: 0,
  driftScoring: false,
  driftZone: false,
  driftLink: 0,
  driftComboProgress: 0,
  driftMessage: '',
  driftBestChain: 0,
  driftLongest: 0,
  driftTransitions: 0,
  driftZoneSeconds: 0,
  driftPeakCombo: 1,
  driftBusts: 0,
  driftPersonalBest: 0,
  driftNewBest: false,
  driftTotal: 0,
  driftCombo: 1,
  driftChain: 0,
  driftGate: 0,
  driftGateCount: 10,
  driftActive: false,
  driftScore: 0,
  driftBanked: 0,
  lap: 0,
  totalLaps: 3,
  currentLapMs: 0,
  lastLapMs: null,
  bestLapMs: null,
  totalMs: 0,
  countdown: 0,
  startLights: 0,
  startLightCount: 5,
  launchRevs: 0,
  launchBandLow: 0.6,
  launchBandHigh: 0.84,
  launchArmed: false,
  launchGrade: 'none',
  launchFlash: false,
  launchReaction: -1,
  freeRoam: false,
  trialLap: 1,
  trialLaps: 0,
  trialValidLaps: 0,
  trialValid: true,
  trialInvalidReason: null,
  trialSessionBestMs: null,
  trialPersonalBestMs: null,
  trialSplitIndex: -1,
  trialSplitMs: 0,
  trialDeltaMs: null,
  trialSplitShow: false,
  trialLastLap: null,
  trialNextGate: 1,
  trialGateCount: 0,
  trialEnded: false,
  callout: null,
  fps: 0,
  carX: 0,
  carZ: 0,
  heading: 0,
  trackIndex: 0,
  distanceLeft: 0,
  wrongWay: false,
  missedCheckpoint: false,
}

export const telemetryStore = createStore<Telemetry>()(() => initialTelemetry)
