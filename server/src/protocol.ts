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

/** Development race transport, available only when the backend has a simulation factory. */
export interface RaceDescriptor {
  protocol: typeof RACE_PROTOCOL
  id: string
  fingerprint: string
  simulationVersion: number
  tickRate: 60
  snapshotRate: 20
  countdownTicks: number
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
export interface RaceSnapshot {
  raceId: string
  tick: number
  phase: 'countdown' | 'racing' | 'finished'
  countdownTicks: number
  progress?: RaceRacerProgress[]
  result?: RaceResult
  vehicles: (RaceVehicleState & { acknowledgedSequence: number })[]
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
