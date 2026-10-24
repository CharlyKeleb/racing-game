import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Client, type Room } from '@colyseus/sdk'
import { createBackend } from '../server/src/server'
import { activePlayers, lobbyDirectory } from '../server/src/LobbyRoom'
import { RACE_PROTOCOL, ROOM_CLOSED_CODE, type LobbySnapshot, type RaceSnapshot } from '../server/src/protocol'
import type { ResultRecord } from '../server/src/ResultRecord'
import type { VerifiedRacer } from '../server/src/auth'
import { scriptedRaceFactory } from './helpers/scriptedRaceFactory'
import { resultPlayers } from './helpers/resultRecord'
let backend: ReturnType<typeof createBackend>, endpoint: string, stationary: boolean
let authWait: (() => Promise<VerifiedRacer>) | undefined, writeGate: Promise<void> | undefined, releaseWrite: (() => void) | undefined
const clients: Room[] = [], lobbies = new Map<string, LobbySnapshot>(), frames = new Map<string, RaceSnapshot>(), records: ResultRecord[] = []
const disposed = vi.fn(), closes = new Map<string, number>()
beforeEach(async () => {
  stationary = false; authWait = undefined; writeGate = undefined; releaseWrite = undefined
  const factory = scriptedRaceFactory(disposed)
  backend = createBackend({ origins: ['http://localhost:5173'], maxRooms: 3, raceFactory: { ...factory, create: async seats => {
    const sim = await factory.create(seats)
    return { ...sim, position: (id, out) => { if (stationary) { out.x = 0; out.y = .6; out.z = 1 } else sim.position(id, out) },
      states: () => sim.states().map(s => stationary ? { ...s, position: { x: 0, y: .6, z: 1 } } : s) }
  } }, resultPersistence: { available: true, enqueue: async (record, notify) => {
    records.push(record); await writeGate
    notify({ raceId: record.result.raceId, state: 'pending' })
  } }, authenticate: async token => {
    if (token === 'delayed' && authWait) return authWait()
    return { id: resultPlayers[token === 'one' ? 0 : 1], handle: token, displayName: token, expiresAt: Date.now() + 300_000 }
  } })
  await backend.listen(0, '127.0.0.1')
  const address = backend.gameServer.transport.server!.address()
  endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})
afterEach(async () => {
  releaseWrite?.()
  await backend?.shutdown(0)
  await Promise.all(clients.splice(0).filter(c => c.connection.isOpen).map(c => c.leave().catch(() => {})))
  lobbies.clear(); frames.clear(); records.length = 0; closes.clear(); vi.restoreAllMocks()
})
const admission = (token: string, code?: string) => fetch(`${endpoint}/rooms`, { method: 'POST', headers: {
  Origin: 'http://localhost:5173', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
}, body: JSON.stringify({ protocol: 1, action: code ? 'join' : 'create', code, carId: 'porsche911' }) })
function watch(room: Room) {
  clients.push(room); room.reconnection.enabled = false
  room.onMessage('lobby', (s: LobbySnapshot) => lobbies.set(room.sessionId, s))
  room.onMessage('race', (s: RaceSnapshot) => frames.set(room.sessionId, s))
  room.onMessage('notice', () => {}); room.onMessage('refreshed', () => {}); room.onMessage('resumed', () => {})
  room.onLeave(code => closes.set(room.sessionId, code))
  return room
}
async function join(token: string, code?: string) {
  const response = await admission(token, code); expect(response.status).toBe(200)
  const room = watch(await new Client(endpoint).consumeSeatReservation(await response.json()))
  room.send('sync'); await vi.waitFor(() => expect(lobbies.has(room.sessionId)).toBe(true))
  return room
}
const current = (room: Room) => lobbies.get(room.sessionId)!
async function grid(phase: 'countdown' | 'racing' | 'finished' = 'racing') {
  const host = await join('one'), guest = await join('two', current(host).code)
  host.send('laps', 1); host.send('ready', true); guest.send('ready', true)
  await vi.waitFor(() => expect(current(host).racers.every(r => r.ready)).toBe(true))
  host.send('start'); await vi.waitFor(() => expect(current(host).phase).toBe('loading'))
  const race = current(host).race!
  for (const c of [host, guest]) c.send('loaded', { protocol: RACE_PROTOCOL, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: 1 })
  await vi.waitFor(() => expect(current(host).phase).toBe(phase), { timeout: 5000 })
  return { host, guest, race }
}
it('aborts a whole-room closure without manufacturing individual DNF results', async () => {
  const { host, guest } = await grid()
  await lobbyDirectory.get(current(host).code)!.disconnect()
  await vi.waitFor(() => expect(closes.size).toBe(2))
  expect(closes.get(host.sessionId)).toBe(ROOM_CLOSED_CODE)
  expect(closes.get(guest.sessionId)).toBe(ROOM_CLOSED_CODE)
  expect(records).toEqual([])
  expect(disposed).toHaveBeenCalledTimes(1)
  expect(activePlayers.has(resultPlayers[0])).toBe(false)
  expect(activePlayers.has(resultPlayers[1])).toBe(false)
}, 10_000)
it('drains admissions, allows an active finish and waits for accepted writes before stopping', async () => {
  const { host, guest, race } = await grid()
  const shutdown = backend.shutdown(3000)
  expect(backend.shutdown(0)).toBe(shutdown)
  expect((await fetch(`${endpoint}/readyz`)).status).toBe(503)
  expect((await fetch(`${endpoint}/healthz`)).status).toBe(200)
  expect((await admission('one')).status).toBe(503)
  await vi.waitFor(() => expect(current(guest).draining).toBe(true))
  expect(await shutdown).toEqual({ abortedRaces: 0, pendingResultWrites: 0 })
  expect(records).toHaveLength(1)
  expect(records[0].result.raceId).toBe(race.id)
  expect(records[0].result.racers.every(r => r.status === 'finished')).toBe(true)
  expect(frames.get(host.sessionId)?.result).toEqual(frames.get(guest.sessionId)?.result)
  expect(disposed).toHaveBeenCalledTimes(1)
}, 10_000)
it('aborts a race at the grace deadline and never persists fabricated shutdown outcomes', async () => {
  stationary = true
  await grid('countdown')
  expect(await backend.shutdown(30)).toEqual({ abortedRaces: 1, pendingResultWrites: 0 })
  expect(records).toEqual([])
  expect(disposed).toHaveBeenCalledTimes(1)
})
it('rejects admission that began authentication before draining', async () => {
  let releaseAuth!: (racer: VerifiedRacer) => void
  authWait = () => new Promise(resolve => { releaseAuth = resolve })
  const request = admission('delayed')
  await vi.waitFor(() => expect(releaseAuth).toBeTypeOf('function'))
  backend.drain()
  releaseAuth({ id: resultPlayers[0], handle: 'one', displayName: 'One', expiresAt: Date.now() + 300_000 })
  expect((await request).status).toBe(503)
  expect(activePlayers.has(resultPlayers[0])).toBe(false)
  expect(lobbyDirectory.size).toBe(0)
})
it('allows only held-seat recovery during drain and still requires fresh identity verification', async () => {
  stationary = true
  const { host, guest, race } = await grid('countdown')
  const secret = guest.reconnectionToken; guest.connection.close(4010)
  await vi.waitFor(() => expect(current(host).racers.find(r => r.id === resultPlayers[1])?.connected).toBe(false))
  backend.drain()
  const recovered = watch(await new Client(endpoint).reconnect(secret))
  recovered.send('refresh', 'two')
  await vi.waitFor(() => expect(current(host).racers.every(r => r.connected)).toBe(true))
  expect(current(host)).toMatchObject({ draining: true, race: { id: race.id } })
  expect(records).toEqual([])
})
it('blocks new race starts and rematches after draining begins', async () => {
  const { host, guest, race } = await grid('finished')
  backend.drain()
  for (const c of [host, guest]) c.send('rematch', { raceId: race.id, ready: true })
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(current(host)).toMatchObject({ phase: 'finished', rematchEnabled: false, rematchVotes: [] })
  host.send('returnLobby'); await vi.waitFor(() => expect(current(host).phase).toBe('lobby'))
  host.send('start'); await new Promise(resolve => setTimeout(resolve, 60))
  expect(current(host).phase).toBe('lobby')
  expect(records).toHaveLength(1)
}, 10_000)
it('reports an unconfirmed durable enqueue at the deadline instead of claiming it was flushed', async () => {
  writeGate = new Promise(resolve => { releaseWrite = resolve })
  await grid('finished')
  await vi.waitFor(() => expect(records).toHaveLength(1))
  expect(await backend.shutdown(30)).toEqual({ abortedRaces: 0, pendingResultWrites: 1 })
  releaseWrite!()
}, 10_000)

it('rejects a not-yet-consumed seat during drain and releases its admission claim at shutdown', async () => {
  const response = await admission('one'); expect(response.status).toBe(200)
  const seat = await response.json()
  backend.drain()
  await expect(new Client(endpoint).consumeSeatReservation(seat)).rejects.toThrow()
  await backend.shutdown(0)
  expect(activePlayers.has(resultPlayers[0])).toBe(false)
})
it('waits for a pending accepted enqueue that completes within the shutdown window', async () => {
  writeGate = new Promise(resolve => { releaseWrite = resolve })
  await grid('finished')
  await vi.waitFor(() => expect(records).toHaveLength(1))
  const shutdown = backend.shutdown(1000)
  setTimeout(() => releaseWrite!(), 80)
  expect(await shutdown).toEqual({ abortedRaces: 0, pendingResultWrites: 0 })
}, 10_000)
