import { Client, type Room } from '@colyseus/sdk'
import { accountStore } from '../stores/accountStore'
import { LOBBY_PROTOCOL, RACE_PROTOCOL, ROOM_CLOSED_CODE, type LobbyCar, type LobbySnapshot, type RaceSnapshot, type RaceInput, type RaceDescriptor, type RaceResume } from '../../server/src/protocol'

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
let recoveryTimer: ReturnType<typeof setTimeout> | undefined
interface ConnectionContext { client: Client; playerId: string; getToken: () => Promise<string | null>; run: number }
const current = (context: ConnectionContext) => context.run === generation && accountStore.getState().player?.id === context.playerId
export async function leaveLobby(): Promise<void> {
  generation++
  clearTimeout(recoveryTimer)
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
    const client = new Client(url.origin)
    const joined = await new Promise<Room>((resolve, reject) => {
      let expired = false
      const deadline = setTimeout(() => { expired = true; reject(new Error('The lobby connection timed out. Try again.')) }, 10_000)
      void client.consumeSeatReservation(reservation).then((connected) => {
        clearTimeout(deadline)
        connected.reconnection.enabled = false
        if (expired || run !== generation) { void connected.leave(); return }
        resolve(connected)
      }).catch((error: unknown) => { clearTimeout(deadline); reject(error) })
    })
    if (run !== generation || accountStore.getState().player?.id !== playerId) { await joined.leave(); return }
    watchRoom(joined, { client, playerId, getToken, run }, false)
    refresh = setInterval(() => {
      if (run !== generation || lobbyStore.getState().status !== 'connected' || !room?.connection.isOpen) return
      void getToken().then((token) => {
        const active = room
        if (run !== generation || !active || lobbyStore.getState().status !== 'connected' || !active.connection.isOpen) return
        if (token) active.send('refresh', token)
        else void leaveLobby()
      }).catch(() => { if (run === generation && lobbyStore.getState().status === 'connected') void leaveLobby() })
    }, 30_000)
  } catch (error) {
    if (run === generation) {
      stopAccountWatch?.()
      stopAccountWatch = undefined
      lobbyStore.setState({ status: 'idle', error: error instanceof Error ? error.message : 'Could not connect. Try again.' })
    }
  }
}
function failedConnection(message: string): void {
  void leaveLobby()
  lobbyStore.setState({ error: message })
}
function watchRoom(joined: Room, context: ConnectionContext, restoring: boolean): void {
  room = joined
  joined.reconnection.enabled = false // The application owns bounded, cancellable retries.
  joined.reconnection.maxEnqueuedMessages = 0
  lobbyStore.setState({ status: restoring ? 'reconnecting' : 'connected', sessionId: joined.sessionId })
  joined.onMessage('lobby', (snapshot: LobbySnapshot) => {
    if (room !== joined || !current(context)) return
    const id = snapshot.race?.id ?? null
    if (id !== inputRaceId) {
      inputRaceId = id; inputSequence = 0; lastInputAt = -Infinity
      lobbyStore.setState({ raceSnapshot: null })
    }
    lobbyStore.setState({ snapshot })
  })
  joined.onMessage('race', (snapshot: RaceSnapshot) => {
    const previous = lobbyStore.getState().raceSnapshot
    if (room !== joined || !current(context) || snapshot.raceId !== inputRaceId || (previous && snapshot.tick <= previous.tick)) return
    lobbyStore.setState({ raceSnapshot: snapshot })
  })
  joined.onMessage('notice', (notice: string) => { if (room === joined && current(context)) lobbyStore.setState({ error: notice }) })
  joined.onMessage('refreshed', () => {})
  joined.onMessage('resumed', (resume: RaceResume) => {
    if (room !== joined || !current(context) || lobbyStore.getState().status !== 'reconnecting') return
    if (!resume || resume.raceId !== inputRaceId || !Number.isSafeInteger(resume.nextInputSequence) || resume.nextInputSequence < 0) {
      failedConnection('The recovered session could not synchronize. Rejoin the lobby.'); return
    }
    inputSequence = resume.nextInputSequence; lastInputAt = -Infinity
    clearTimeout(recoveryTimer)
    lobbyStore.setState(s => ({ status: 'connected', error: null, connectionEpoch: s.connectionEpoch + 1 }))
  })
  joined.onLeave((code) => {
    if (room !== joined || !current(context)) return
    const grace = lobbyStore.getState().snapshot?.reconnectGraceSeconds
    if (lobbyStore.getState().status === 'connected' && grace === 15 && [1001, 1005, 1006, 4010].includes(code)) {
      void recoverRoom(joined, context)
    } else failedConnection(code === ROOM_CLOSED_CODE ? 'The room closed for a restart or expiry. Create or join a new lobby.' : code === 4001 ? 'Your session ended. Sign in again to rejoin.' : 'Disconnected from the lobby. You can create or join another.')
  })
  joined.onError(() => { if (room === joined && current(context) && lobbyStore.getState().status !== 'reconnecting') lobbyStore.setState({ error: 'The lobby connection had a problem. Leave and rejoin if it persists.' }) })
  if (!restoring) joined.send('sync')
}
async function recoverRoom(previous: Room, context: ConnectionContext): Promise<void> {
  const until = Date.now() + 15_000
  lobbyStore.setState({ status: 'reconnecting', error: null })
  clearTimeout(recoveryTimer)
  recoveryTimer = setTimeout(() => {
    if (current(context) && lobbyStore.getState().status === 'reconnecting') failedConnection('Could not reconnect in time. Return to the lobby to try again.')
  }, 15_000)
  while (current(context) && room === previous && Date.now() < until) {
    let recovered: Room
    try { recovered = await context.client.reconnect(previous.reconnectionToken) }
    catch {
      if (!current(context) || room !== previous) return
      await new Promise(resolve => setTimeout(resolve, Math.min(500, Math.max(0, until - Date.now()))))
      continue
    }
    recovered.reconnection.enabled = false
    if (!current(context) || room !== previous || Date.now() >= until) { if (recovered.connection.isOpen) void recovered.leave().catch(() => {}); return }
    watchRoom(recovered, context, true)
    try {
      const token = await context.getToken()
      if (!current(context) || room !== recovered) return
      if (!token) { failedConnection('Sign in again to recover your racer.'); return }
      // This token proves the original immutable identity; the seat secret alone cannot drive.
      if (recovered.connection.isOpen) recovered.send('refresh', token)
    } catch { if (current(context) && room === recovered) failedConnection('Sign in again to recover your racer.') }
    return
  }
}
function sendControl(type: string, value?: unknown): void {
  if (room?.connection.isOpen && lobbyStore.getState().status === 'connected') room.send(type, value)
}
export function setLobbyReady(ready: boolean) { sendControl('ready', ready) }
export function setLobbyCar(carId: LobbyCar) { sendControl('car', carId) }
export function setLobbyLaps(laps: number) { sendControl('laps', laps) }

if (import.meta.hot) import.meta.hot.dispose(() => { void leaveLobby() })

/** Transport commands for the upcoming browser race adapter; no automatic local-race launch. */
export function startLobbyRace() { sendControl('start') }
export function setRematchReady(ready: boolean) {
  if (inputRaceId && lobbyStore.getState().snapshot?.phase === 'finished') sendControl('rematch', { raceId: inputRaceId, ready })
}
export function returnToLobby() { sendControl('returnLobby') }
export function cancelLobbyRace() { sendControl('cancelRace') }
export function acknowledgeRaceLoaded(race: RaceDescriptor) {
  if (lobbyStore.getState().snapshot?.race?.id !== race.id) return
  if (race.protocol !== RACE_PROTOCOL) { lobbyStore.setState({ error: 'Refresh the game to load this race version.' }); return }
  sendControl('loaded', { protocol: race.protocol, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: race.simulationVersion })
}
export function sendRaceInput(input: Omit<RaceInput, 'raceId' | 'sequence'>): number | null {
  if (!room?.connection.isOpen || lobbyStore.getState().status !== 'connected' || !inputRaceId || lobbyStore.getState().snapshot?.phase !== 'racing') return null
  const now = performance.now()
  if (now - lastInputAt < 1000 / 30) return null
  lastInputAt = now
  const sequence = inputSequence++
  room.send('input', { raceId: inputRaceId, sequence, throttle: input.throttle, brake: input.brake, steer: input.steer,
    steerSource: input.steerSource, handbrake: input.handbrake, nitro: input.nitro })
  return sequence
}
