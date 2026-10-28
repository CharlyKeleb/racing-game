/** Shared lobby and optional development race transport. No client-authored builds or results. */
export const ROOM_CLOSED_CODE = 4011
export const LOBBY_PROTOCOL = 1
export const LOBBY_CARS = ['porsche911', 'koenigsegg', 'bmw', 'diablo', 'amg', 'charger'] as const
export type LobbyCar = typeof LOBBY_CARS[number]
export interface LobbyRacer {
  sessionId: string
  id: string
  handle: string
  displayName: string
  carId: LobbyCar
  ready: boolean
  connected?: boolean
}
export interface LobbySnapshot {
  protocol: number
  code: string
  hostId: string
  racers: LobbyRacer[]
  maxPlayers: number
  track: 'nurburgring'
  laps: number
  phase: 'lobby' | 'loading' | 'countdown' | 'racing' | 'finished'
  /** Additive capability: bounded integer echo over the authenticated room socket. */
  latencyProbe?: boolean
  draining?: boolean
  raceEnabled: boolean
  reconnectGraceSeconds?: number
  rematchEnabled?: boolean
  rematchVotes?: string[]
  rematchExpiresAt?: number
  raceRacers?: LobbyRacer[]
  race: RaceDescriptor | null
  resultPersistence?: ResultPersistence
}
export function isLobbyCar(value: unknown): value is LobbyCar {
  return typeof value === 'string' && (LOBBY_CARS as readonly string[]).includes(value)
}

export const RACE_PROTOCOL = 3
/** Racing ticks the rest of the field has to finish after the first finisher. */
export const FINISH_WINDOW_TICKS = 60 * 60
export const CORRECTION_VERSION = 1
/** Additive capability: `{ version: 1, raceId }` puts the racer back before its last counted gate. */
export const RESET_VERSION = 1
/** Minimum wall time between accepted resets for one racer. */
export const RESET_INTERVAL_MS = 2000
export const MAX_CORRECTION_BYTES = 8192
export const CORRECTION_INTERVAL_TICKS = 6

/** Development race transport, available only when the backend has a simulation factory. */
export interface RaceDescriptor {
  protocol: typeof RACE_PROTOCOL
  id: string
  fingerprint: string
  simulationVersion: number
  tickRate: 60
  snapshotRate: 20
  countdownTicks: number
  correctionVersion?: typeof CORRECTION_VERSION
  scheduledInputVersion?: 1
  resetVersion?: typeof RESET_VERSION
}
export interface RaceInput {
  raceId: string
  sequence: number
  throttle: number
  brake: number
  steer: number
  steerSource?: 'keyboard' | 'analog'
  handbrake: boolean
  nitro: boolean
}
/** Optional practice controls assigned to a bounded future server step, not a client-owned clock. */
export interface ScheduledRaceInput extends RaceInput { version: 1; tick: number }
export interface RaceVehicleState {
  id: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number; w: number }
  velocity: { x: number; y: number; z: number }
  angularVelocity: { x: number; y: number; z: number }
  speed: number
  steer: number
  rpm: number
  gear: number
  nitro: number
  nitroIntensity?: number
  braking?: number
  wheelOffsets?: number[]
}
/** What the most recently completed physics step actually consumed, not current socket intent. */
export interface InputApplication {
  mode: 'hold' | 'neutral' | 'command'
  /** First/last completed server tick that used acknowledgedSequence; null until any command is applied. */
  firstTick: number | null
  lastTick: number | null
}
export function isInputApplication(value: unknown, sequence: number, snapshotTick: number): value is InputApplication {
  if (!Number.isSafeInteger(snapshotTick) || snapshotTick < 0 || !value || typeof value !== 'object' || Array.isArray(value)) return false
  const state = value as InputApplication
  if (Object.keys(state).some(k => k !== 'mode' && k !== 'firstTick' && k !== 'lastTick')
    || !['hold', 'neutral', 'command'].includes(state.mode)) return false
  if (sequence === -1) return state.mode !== 'command' && state.firstTick === null && state.lastTick === null
  return Number.isSafeInteger(sequence) && sequence >= 0
    && Number.isSafeInteger(state.firstTick) && state.firstTick! >= 1
    && Number.isSafeInteger(state.lastTick) && state.lastTick! >= state.firstTick! && state.lastTick! <= snapshotTick
    && (state.mode !== 'command' || state.lastTick === snapshotTick)
}
export interface RaceSnapshot {
  raceId: string
  tick: number
  phase: 'countdown' | 'racing' | 'finished'
  countdownTicks: number
  progress?: RaceRacerProgress[]
  result?: RaceResult
  vehicles: (RaceVehicleState & { acknowledgedSequence: number; inputApplication?: InputApplication })[]
}

export interface RaceRacerProgress {
  id: string
  completedLaps: number
  nextCheckpoint: number
  lapTicks: number[]
  finishTicks: number | null
  retiredTicks?: number
  dnfReason?: RetirementReason
}
/** Session-only practice results. No client submission or offline record promotion. */
export interface RaceResult {
  raceId: string
  track: 'nurburgring'
  laps: number
  tickRate: 60
  completedTick: number
  reason: 'all-finished' | 'finish-window' | 'time-limit' | 'all-resolved'
  racers: readonly {
    id: string
    carId: LobbyCar
    status: 'finished' | 'dnf'
    rank: number | null
    finishTicks: number | null
    retiredTicks?: number
    dnfReason?: RetirementReason
    lapTicks: readonly number[]
  }[]
}

export interface ResultPersistence {
  raceId: string
  state: 'disabled' | 'saving' | 'pending' | 'saved' | 'failed'
  savedAt?: string
}

export interface RaceResume {
  raceId: string | null
  nextInputSequence: number
}

export type RetirementReason = 'left' | 'connection-lost' | 'auth-expired'

/** Trusted simulation adapter output; backend never imports the browser controller implementation. */
export interface CorrectionPhysicsState {
  body: {
    position: { x: number; y: number; z: number }
    rotation: { x: number; y: number; z: number; w: number }
    velocity: { x: number; y: number; z: number }
    angularVelocity: { x: number; y: number; z: number }
    sleeping: boolean
  }
  controller: unknown
}
export interface CorrectionEnvelope extends CorrectionPhysicsState {
  version: typeof CORRECTION_VERSION
  raceProtocol: typeof RACE_PROTOCOL
  raceId: string
  racerId: string
  carId: LobbyCar
  fingerprint: string
  simulationVersion: number
  tick: number
  acknowledgedSequence: number
  inputApplication: InputApplication
}
