/** Shared lobby protocol. No physics, build upgrades or client-authored race results. */
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
  phase: 'lobby'
}
export function isLobbyCar(value: unknown): value is LobbyCar {
  return typeof value === 'string' && (LOBBY_CARS as readonly string[]).includes(value)
}
