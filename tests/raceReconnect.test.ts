import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Client, type Room } from '@colyseus/sdk'
import { createBackend } from '../server/src/server'
import { activePlayers } from '../server/src/LobbyRoom'
import { RACE_PROTOCOL, type LobbySnapshot, type RaceSnapshot, type RaceResume } from '../server/src/protocol'
import { createRaceFactory, type SimulationBundle } from '../scripts/multiplayer/race-factory'
// @ts-expect-error Offline exporter is an untyped ES module.
import { buildSimulationAssets } from '../scripts/multiplayer/build-simulation-assets.mjs'
let backend: ReturnType<typeof createBackend>, endpoint: string
const clients: Room[] = [], snapshots = new Map<string, LobbySnapshot>(), frames = new Map<string, RaceSnapshot>()
const applied = new Map<string, { throttle: number; nitro: boolean }>()
const disposed = vi.fn(), expirations = new Map<string, number>()
const origin = 'http://localhost:5173'
beforeAll(async () => {
  const factory = createRaceFactory(await buildSimulationAssets() as SimulationBundle)
  const warm = await factory.create([{ id: 'warm1', sessionId: 'w1', carId: 'porsche911' }, { id: 'warm2', sessionId: 'w2', carId: 'diablo' }]); warm.dispose()
  backend = createBackend({ origins: [origin], maxRooms: 5, raceFactory: { ...factory, create: async seats => {
    const sim = await factory.create(seats)
    return { ...sim, setInput: (id, input) => { applied.set(id, { throttle: input.throttle, nitro: input.nitro }); sim.setInput(id, input) }, dispose: () => { disposed(); sim.dispose() } }
  } }, authenticate: async token => {
    const id = token === 'renewed-short' ? 'short' : token
    const expiresAt = token === 'short' ? expirations.get(token) ?? Date.now() + 700 : Date.now() + 60_000
    expirations.set(token, expiresAt)
    return { id, handle: id, displayName: id, expiresAt }
  } })
  await backend.listen(0, '127.0.0.1')
  const address = backend.gameServer.transport.server!.address()
  endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
}, 30_000)
afterEach(async () => {
  await Promise.all(clients.splice(0).filter(c => c.connection.isOpen).map(c => c.leave().catch(() => {})))
  snapshots.clear(); frames.clear(); applied.clear(); disposed.mockClear(); expirations.clear()
})
afterAll(async () => { await backend?.gameServer.gracefullyShutdown(false) })
function listen(room: Room) {
  room.reconnection.enabled = false
  clients.push(room)
  room.onMessage('lobby', (s: LobbySnapshot) => snapshots.set(room.sessionId, s))
  room.onMessage('race', (s: RaceSnapshot) => frames.set(room.sessionId, s))
  room.onMessage('notice', () => {}); room.onMessage('refreshed', () => {})
  return room
}
async function admission(token: string, code?: string) {
  return fetch(`${endpoint}/rooms`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol: 1, action: code ? 'join' : 'create', code, carId: 'porsche911' }) })
}
async function join(token: string, code?: string) {
  const response = await admission(token, code); expect(response.status).toBe(200)
  const room = listen(await new Client(endpoint).consumeSeatReservation(await response.json()))
  room.send('sync'); await vi.waitFor(() => expect(snapshots.has(room.sessionId)).toBe(true))
  return room
}
const current = (room: Room) => snapshots.get(room.sessionId)!
async function grid() {
  const host = await join('host'), guest = await join('guest', current(host).code)
  host.send('ready', true); guest.send('ready', true)
  await vi.waitFor(() => expect(current(host).racers.every(r => r.ready)).toBe(true))
  host.send('start')
  await vi.waitFor(() => expect(current(guest).race).toBeTruthy())
  const race = current(guest).race!
  for (const c of [host, guest]) c.send('loaded', { protocol: RACE_PROTOCOL, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: race.simulationVersion })
  await vi.waitFor(() => expect(current(host).phase).toBe('racing'), { timeout: 5000 })
  return { host, guest, race }
}
it('restores the same car and sequence after fresh authentication, without replaying held controls or admitting a duplicate racer', async () => {
  const { host, guest, race } = await grid()
  guest.send('input', { raceId: race.id, sequence: 0, throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: true })
  await vi.waitFor(() => expect(frames.get(host.sessionId)?.vehicles[1].acknowledgedSequence).toBe(0))
  const before = frames.get(host.sessionId)!
  const secret = guest.reconnectionToken
  guest.connection.close(4010)
  await vi.waitFor(() => expect(current(host).racers.find(r => r.id === 'guest')?.connected).toBe(false))
  expect(current(host).race?.id).toBe(race.id)
  expect((await admission('guest', current(host).code)).status).toBe(409)
  await vi.waitFor(() => expect(applied.get('guest')).toEqual({ throttle: 0, nitro: false }))
  const restored = listen(await new Client(endpoint).reconnect(secret))
  let resume: RaceResume | undefined
  restored.onMessage('resumed', (r: RaceResume) => { resume = r })
  expect(restored.sessionId).toBe(guest.sessionId)
  restored.send('input', { raceId: race.id, sequence: 1, throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: true })
  restored.send('sync')
  await new Promise(resolve => setTimeout(resolve, 60))
  expect(current(host).racers.find(r => r.id === 'guest')?.connected).toBe(false)
  expect(frames.get(host.sessionId)?.vehicles[1].acknowledgedSequence).toBe(0)
  restored.send('refresh', 'guest')
  await vi.waitFor(() => expect(resume).toEqual({ raceId: race.id, nextInputSequence: 1 }))
  expect(current(host).racers.find(r => r.id === 'guest')?.connected).toBe(true)
  expect(frames.get(host.sessionId)!.tick).toBeGreaterThan(before.tick)
  expect(frames.get(host.sessionId)!.vehicles.map(v => v.id)).toEqual(before.vehicles.map(v => v.id))
  expect(frames.get(host.sessionId)!.progress).toEqual(before.progress)
  expect(disposed).not.toHaveBeenCalled()
  restored.send('input', { raceId: race.id, sequence: 1, throttle: .5, brake: 0, steer: 0, handbrake: false, nitro: false })
  await vi.waitFor(() => expect(frames.get(host.sessionId)?.vehicles[1].acknowledgedSequence).toBe(1))
  expect(applied.get('guest')).toEqual({ throttle: .5, nitro: false })
  await expect(new Client(endpoint).reconnect(secret)).rejects.toThrow()
  expect(current(host).racers).toHaveLength(2)
}, 12_000)
it('requires the original Auth UUID even with a valid held-seat secret', async () => {
  const host = await join('host'), guest = await join('guest', current(host).code)
  const secret = guest.reconnectionToken
  guest.connection.close(4010)
  await vi.waitFor(() => expect(current(host).racers.find(r => r.id === 'guest')?.connected).toBe(false))
  const restored = listen(await new Client(endpoint).reconnect(secret))
  restored.onMessage('resumed', () => { throw new Error('Wrong identity resumed') })
  const left = new Promise<number>(resolve => restored.onLeave(resolve))
  restored.send('refresh', 'intruder')
  expect(await left).toBe(4001)
  await vi.waitFor(() => expect(current(host).racers).toHaveLength(1))
  expect(activePlayers.has('guest')).toBe(false)
})
it('caps a held seat by its original auth expiry and resets lobby readiness', async () => {
  const host = await join('host'), guest = await join('short', current(host).code)
  guest.send('ready', true)
  await vi.waitFor(() => expect(current(host).racers.find(r => r.id === 'short')?.ready).toBe(true))
  guest.connection.close(4010)
  await vi.waitFor(() => expect(current(host).racers.find(r => r.id === 'short')).toMatchObject({ connected: false, ready: false }))
  await vi.waitFor(() => expect(current(host).racers).toHaveLength(1), { timeout: 2500 })
  expect(activePlayers.has('short')).toBe(false)
  const fresh = await join('renewed-short', current(host).code)
  expect(current(fresh).racers.find(r => r.id === 'short')).toMatchObject({ connected: true, ready: false })
})
it('aborts an unfinished race after the full grace deadline and frees the sole simulation', async () => {
  const { host, guest, race } = await grid()
  guest.connection.close(4010)
  await vi.waitFor(() => expect(current(host).racers.find(r => r.id === 'guest')?.connected).toBe(false))
  expect(current(host).race?.id).toBe(race.id)
  await vi.waitFor(() => expect(current(host)).toMatchObject({ phase: 'lobby', race: null }), { timeout: 17_000, interval: 100 })
  expect(disposed).toHaveBeenCalledTimes(1)
  expect(activePlayers.has('guest')).toBe(false)
  expect(current(host).racers.every(r => !r.ready)).toBe(true)
}, 22_000)
