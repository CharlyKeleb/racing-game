/** Shared lobby and optional development race transport. No client-authored builds or results. */
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
}
export interface LobbySnapshot {
  protocol: number
  code: string
  hostId: string
  racers: LobbyRacer[]
  maxPlayers: number
  track: 'nurburgring'
  laps: number
  phase: 'lobby' | 'loading' | 'countdown' | 'racing'
  raceEnabled: boolean
  race: RaceDescriptor | null
}
export function isLobbyCar(value: unknown): value is LobbyCar {
  return typeof value === 'string' && (LOBBY_CARS as readonly string[]).includes(value)
}

export const RACE_PROTOCOL = 1

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
  phase: 'countdown' | 'racing'
  countdownTicks: number
  vehicles: (RaceVehicleState & { acknowledgedSequence: number })[]
}
