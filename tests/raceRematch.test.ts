import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Client, type Room } from '@colyseus/sdk'
import { createBackend } from '../server/src/server'
import { RACE_PROTOCOL, type LobbySnapshot, type RaceSnapshot } from '../server/src/protocol'
import type { ResultRecord } from '../server/src/ResultRecord'
import { scriptedRaceFactory } from './helpers/scriptedRaceFactory'
import { resultPlayers } from './helpers/resultRecord'
let backend: ReturnType<typeof createBackend>, endpoint: string, available: boolean
const clients: Room[] = [], lobbies = new Map<string, LobbySnapshot>(), frames = new Map<string, RaceSnapshot>(), records: ResultRecord[] = []
beforeEach(async () => {
  available = true
  backend = createBackend({ origins: ['http://localhost:5173'], maxRooms: 2, raceFactory: scriptedRaceFactory(),
    resultPersistence: { get available() { return available }, enqueue: async (record, notify) => {
      records.push(record); notify({ raceId: record.result.raceId, state: 'saved', savedAt: new Date().toISOString() })
    } }, authenticate: async token => ({ id: resultPlayers[token === 'one' ? 0 : 1], handle: token, displayName: token, expiresAt: Date.now() + 300_000 }) })
  await backend.listen(0, '127.0.0.1')
  const address = backend.gameServer.transport.server!.address()
  endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})
afterEach(async () => {
  await Promise.all(clients.splice(0).filter(c => c.connection.isOpen).map(c => c.leave().catch(() => {})))
  await backend?.gameServer.gracefullyShutdown(false)
  lobbies.clear(); frames.clear(); records.length = 0; vi.restoreAllMocks()
})
async function join(token: string, code?: string) {
  const response = await fetch(`${endpoint}/rooms`, { method: 'POST', headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol: 1, action: code ? 'join' : 'create', code, carId: 'porsche911' }) })
  expect(response.status).toBe(200)
  const room = await new Client(endpoint).consumeSeatReservation(await response.json())
  clients.push(room); room.reconnection.enabled = false
  room.onMessage('lobby', (s: LobbySnapshot) => lobbies.set(room.sessionId, s))
  room.onMessage('race', (s: RaceSnapshot) => frames.set(room.sessionId, s))
  room.onMessage('notice', () => {}); room.onMessage('refreshed', () => {}); room.onMessage('resumed', () => {})
  room.send('sync'); await vi.waitFor(() => expect(lobbies.has(room.sessionId)).toBe(true))
  return room
}
const current = (room: Room) => lobbies.get(room.sessionId)!
async function grid() {
  const host = await join('one'), guest = await join('two', current(host).code)
  host.send('laps', 1); host.send('ready', true); guest.send('ready', true)
  await vi.waitFor(() => expect(current(host).racers.every(r => r.ready)).toBe(true))
  host.send('start'); await vi.waitFor(() => expect(current(host).phase).toBe('loading'))
  const race = current(host).race!
  // Before finishing, no rematch command may create votes or another world.
  host.send('rematch', { raceId: race.id, ready: true })
  for (const c of [host, guest]) c.send('loaded', { protocol: RACE_PROTOCOL, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: 1 })
  await vi.waitFor(() => expect(current(host).phase).toBe('finished'), { timeout: 5000 })
  expect(current(host).rematchVotes).toEqual([])
  return { host, guest, race }
}
const vote = (room: Room, raceId: string, ready = true) => room.send('rematch', { raceId, ready })
it('requires both racers, supports withdrawal and launches exactly one fresh loading handshake', async () => {
  const { host, guest, race } = await grid()
  vote(host, race.id); vote(host, race.id)
  await vi.waitFor(() => expect(current(guest).rematchVotes).toEqual([resultPlayers[0]]))
  expect(current(host).phase).toBe('finished')
  const expiresAt = current(host).rematchExpiresAt
  vote(host, race.id, false)
  await vi.waitFor(() => expect(current(host).rematchVotes).toEqual([]))
  expect(current(host).rematchExpiresAt).toBeUndefined()
  vote(host, race.id); vote(guest, 'stale-race')
  await vi.waitFor(() => expect(current(host).rematchVotes).toEqual([resultPlayers[0]]))
  expect(current(host).race!.id).toBe(race.id)
  vote(guest, race.id); vote(guest, race.id)
  await vi.waitFor(() => expect(current(host).phase).toBe('loading'))
  const rematch = current(host).race!
  expect(rematch.id).not.toBe(race.id)
  expect(current(host)).toMatchObject({ laps: 1, rematchVotes: [] })
  expect(current(host).racers.map(r => r.carId)).toEqual(['porsche911', 'porsche911'])
  expect(current(host).rematchExpiresAt).toBeUndefined()
  expect(expiresAt).toBeGreaterThan(Date.now() - 1000)
  for (const c of [host, guest]) c.send('loaded', { protocol: RACE_PROTOCOL, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: 1 })
  await new Promise(resolve => setTimeout(resolve, 80))
  expect(current(host).phase).toBe('loading')
  for (const c of [host, guest]) c.send('loaded', { protocol: RACE_PROTOCOL, raceId: rematch.id, fingerprint: rematch.fingerprint, simulationVersion: 1 })
  await vi.waitFor(() => expect(current(host).phase).toBe('finished'), { timeout: 5000 })
  expect(records.map(r => r.result.raceId)).toEqual([race.id, rematch.id])
}, 12_000)
it('clears consent on transport loss and requires both racers to vote again after reauth', async () => {
  const { host, guest, race } = await grid()
  vote(host, race.id)
  await vi.waitFor(() => expect(current(host).rematchVotes).toHaveLength(1))
  const secret = guest.reconnectionToken; guest.connection.close(4010)
  await vi.waitFor(() => expect(current(host).rematchVotes).toEqual([]))
  vote(host, race.id)
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(current(host).rematchVotes).toEqual([])
  const recovered = await new Client(endpoint).reconnect(secret); clients.push(recovered); recovered.reconnection.enabled = false
  recovered.onMessage('lobby', () => {}); recovered.onMessage('race', () => {}); recovered.onMessage('refreshed', () => {}); recovered.onMessage('resumed', () => {})
  recovered.send('refresh', 'two')
  await vi.waitFor(() => expect(current(host).racers.every(r => r.connected)).toBe(true))
  vote(recovered, race.id)
  await vi.waitFor(() => expect(current(host).rematchVotes).toEqual([resultPlayers[1]]))
  expect(current(host).phase).toBe('finished')
}, 10_000)
it('rejects rematch after a racer leaves and retains host-controlled return to lobby', async () => {
  const { host, guest, race } = await grid()
  vote(host, race.id); await vi.waitFor(() => expect(current(host).rematchVotes).toHaveLength(1))
  await guest.leave()
  await vi.waitFor(() => expect(current(host).racers).toHaveLength(1))
  vote(host, race.id)
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(current(host)).toMatchObject({ phase: 'finished', rematchVotes: [] })
  host.send('returnLobby')
  await vi.waitFor(() => expect(current(host)).toMatchObject({ phase: 'lobby', race: null, rematchVotes: [] }))
}, 10_000)
it('expires votes at sixty seconds without extending them on duplicate requests', async () => {
  const { host, guest, race } = await grid()
  const originalTimer = globalThis.setTimeout
  let expire!: () => void
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms: number, ...args: unknown[]) => {
    if (ms === 60_000) expire = callback
    return originalTimer(callback, ms, ...args)
  }) as typeof setTimeout)
  vote(host, race.id); await vi.waitFor(() => expect(current(host).rematchVotes).toHaveLength(1))
  const deadline = current(host).rematchExpiresAt
  vote(host, race.id); await new Promise(resolve => setTimeout(resolve, 60))
  expect(current(host).rematchExpiresAt).toBe(deadline)
  expect(expire).toBeTypeOf('function'); expire()
  await vi.waitFor(() => expect(current(host).rematchVotes).toEqual([]))
  vote(guest, race.id)
  await vi.waitFor(() => expect(current(host).rematchVotes).toEqual([resultPlayers[1]]))
  expect(current(host).phase).toBe('finished')
}, 10_000)
it('blocks a rematch when the result outbox is full and keeps the old result available', async () => {
  const { host, guest, race } = await grid(); available = false
  vote(host, race.id); vote(guest, race.id)
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(current(host)).toMatchObject({ phase: 'finished', race: { id: race.id }, rematchVotes: [] })
  expect(records).toHaveLength(1)
  expect(frames.get(host.sessionId)?.result?.raceId).toBe(race.id)
}, 10_000)
