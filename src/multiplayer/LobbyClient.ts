import { Client, type Room } from '@colyseus/sdk'
import { createStore } from 'zustand/vanilla'
import { accountStore } from '../stores/accountStore'
import { LOBBY_PROTOCOL, type LobbyCar, type LobbySnapshot } from '../../server/src/protocol'

interface LobbyState {
  status: 'idle' | 'connecting' | 'connected'
  snapshot: LobbySnapshot | null
  sessionId: string | null
  error: string | null
}
export const lobbyStore = createStore<LobbyState>()(() => ({ status: 'idle', snapshot: null, sessionId: null, error: null }))
const endpoint = import.meta.env.VITE_MULTIPLAYER_URL as string | undefined
export const multiplayerConfigured = !!endpoint
let room: Room | null = null
let refresh: ReturnType<typeof setInterval> | undefined
let stopAccountWatch: (() => void) | undefined
let generation = 0
export async function leaveLobby(): Promise<void> {
  generation++
  const previous = room
  room = null
  clearInterval(refresh)
  stopAccountWatch?.()
  stopAccountWatch = undefined
  lobbyStore.setState({ status: 'idle', snapshot: null, sessionId: null })
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
    joined.onMessage('lobby', (snapshot: LobbySnapshot) => lobbyStore.setState({ snapshot }))
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
