import { Client, type Room } from '@colyseus/sdk'
import { accountStore } from '../stores/accountStore'
import { LOBBY_PROTOCOL, RACE_PROTOCOL, type LobbyCar, type LobbySnapshot, type RaceSnapshot, type RaceInput, type RaceDescriptor } from '../../server/src/protocol'

import { lobbyStore } from './lobbyStore'
export { lobbyStore } from './lobbyStore'

const endpoint = import.meta.env.VITE_MULTIPLAYER_URL as string | undefined
export const multiplayerConfigured = !!endpoint
let room: Room | null = null
let refresh: ReturnType<typeof setInterval> | undefined
let stopAccountWatch: (() => void) | undefined
let generation = 0
let lastInputAt = -Infinity
let inputSequence = 0
let inputRaceId: string | null = null
export async function leaveLobby(): Promise<void> {
  generation++
  inputSequence = 0
  lastInputAt = -Infinity
  inputRaceId = null
  const previous = room
  room = null
  clearInterval(refresh)
  stopAccountWatch?.()
  stopAccountWatch = undefined
  lobbyStore.setState({ status: 'idle', snapshot: null, raceSnapshot: null, sessionId: null })
  if (previous?.connection.isOpen) await previous.leave().catch(() => {})
}
export async function enterLobby(action: 'create' | 'join', code: string, carId: LobbyCar, getToken: () => Promise<string | null>): Promise<void> {
  if (room || lobbyStore.getState().status === 'connecting') return
  const run = ++generation
  const playerId = accountStore.getState().player?.id
  lobbyStore.setState({ status: 'connecting', error: null })
  stopAccountWatch = accountStore.subscribe((state) => { if (state.player?.id !== playerId) void leaveLobby() })
  try {
    if (!endpoint) throw new Error('Online lobbies are not available yet.')
    const url = new URL(endpoint)
    if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('The online service is not configured correctly.')
    const token = await getToken()
    if (!token || !playerId) throw new Error('Sign in again to join online.')
    const response = await fetch(`${url.origin}/rooms`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, code, carId, protocol: LOBBY_PROTOCOL }), signal: AbortSignal.timeout(12_000) })
    const reservation = await response.json()
    if (!response.ok) throw new Error(typeof reservation.error === 'string' ? reservation.error : 'Could not join the lobby.')
    if (run !== generation || accountStore.getState().player?.id !== playerId) return
    const joined = await new Promise<Room>((resolve, reject) => {
      let expired = false
      const deadline = setTimeout(() => { expired = true; reject(new Error('The lobby connection timed out. Try again.')) }, 10_000)
      void new Client(url.origin).consumeSeatReservation(reservation).then((connected) => {
        clearTimeout(deadline)
        connected.reconnection.enabled = false
        if (expired || run !== generation) { void connected.leave(); return }
        resolve(connected)
      }).catch((error: unknown) => { clearTimeout(deadline); reject(error) })
    })
    if (run !== generation || accountStore.getState().player?.id !== playerId) { await joined.leave(); return }
    room = joined
    lobbyStore.setState({ status: 'connected', sessionId: joined.sessionId })
    joined.onMessage('lobby', (snapshot: LobbySnapshot) => {
      if (room !== joined) return
      const id = snapshot.race?.id ?? null
      if (id !== inputRaceId) {
        inputRaceId = id
        inputSequence = 0
        lastInputAt = -Infinity
        lobbyStore.setState({ raceSnapshot: null })
      }
      lobbyStore.setState({ snapshot })
    })
    joined.onMessage('race', (snapshot: RaceSnapshot) => {
      const previous = lobbyStore.getState().raceSnapshot
      if (room !== joined || snapshot.raceId !== inputRaceId || (previous && snapshot.tick <= previous.tick)) return
      lobbyStore.setState({ raceSnapshot: snapshot })
    })
    joined.onMessage('notice', (notice: string) => lobbyStore.setState({ error: notice }))
    joined.onMessage('refreshed', () => {})
    joined.onLeave((code) => {
      if (room !== joined) return
      void leaveLobby()
      lobbyStore.setState({ error: code === 4001 ? 'Your session ended. Sign in again to rejoin.' : 'Disconnected from the lobby. You can create or join another.' })
    })
    joined.onError(() => lobbyStore.setState({ error: 'The lobby connection had a problem. Leave and rejoin if it persists.' }))
    joined.send('sync')
    refresh = setInterval(() => {
      void getToken().then((token) => {
        if (room !== joined) return
        if (token) joined.send('refresh', token)
        else void leaveLobby()
      }).catch(() => { if (room === joined) void leaveLobby() })
    }, 30_000)
  } catch (error) {
    if (run === generation) {
      stopAccountWatch?.()
      stopAccountWatch = undefined
      lobbyStore.setState({ status: 'idle', error: error instanceof Error ? error.message : 'Could not connect. Try again.' })
    }
  }
}
export function setLobbyReady(ready: boolean) { room?.send('ready', ready) }
export function setLobbyCar(carId: LobbyCar) { room?.send('car', carId) }
export function setLobbyLaps(laps: number) { room?.send('laps', laps) }

if (import.meta.hot) import.meta.hot.dispose(() => { void leaveLobby() })

/** Transport commands for the upcoming browser race adapter; no automatic local-race launch. */
export function startLobbyRace() { room?.send('start') }
export function cancelLobbyRace() { room?.send('cancelRace') }
export function acknowledgeRaceLoaded(race: RaceDescriptor) {
  if (lobbyStore.getState().snapshot?.race?.id !== race.id) return
  if (race.protocol !== RACE_PROTOCOL) { lobbyStore.setState({ error: 'Refresh the game to load this race version.' }); return }
  room?.send('loaded', { protocol: race.protocol, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: race.simulationVersion })
}
export function sendRaceInput(input: Omit<RaceInput, 'raceId' | 'sequence'>): number | null {
  if (!room || !inputRaceId || lobbyStore.getState().snapshot?.phase !== 'racing') return null
  const now = performance.now()
  if (now - lastInputAt < 1000 / 30) return null
  lastInputAt = now
  const sequence = inputSequence++
  room.send('input', { raceId: inputRaceId, sequence, throttle: input.throttle, brake: input.brake, steer: input.steer,
    steerSource: input.steerSource, handbrake: input.handbrake, nitro: input.nitro })
  return sequence
}
