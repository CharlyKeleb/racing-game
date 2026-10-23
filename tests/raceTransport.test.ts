import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { Client, type Room } from '@colyseus/sdk'
import { createBackend } from '../server/src/server'
import { LOBBY_PROTOCOL, type LobbySnapshot, type RaceSnapshot } from '../server/src/protocol'
import { createRaceFactory, type SimulationBundle } from '../scripts/multiplayer/race-factory'
// @ts-expect-error The offline exporter is an untyped ES module.
import { buildSimulationAssets } from '../scripts/multiplayer/build-simulation-assets.mjs'

let backend: ReturnType<typeof createBackend>
let endpoint: string
const clients: Room[] = []
const lobby = new Map<string, LobbySnapshot>()
const frames = new Map<string, Map<number, RaceSnapshot>>()
const origin = 'http://localhost:5173'
const disposed = vi.fn()

beforeAll(async () => {
  const bundle = await buildSimulationAssets() as SimulationBundle
  const factory = createRaceFactory(bundle)
  // Warm WASM outside the clocked server session (startup work is not race time).
  const warmup = await factory.create([{ id: 'warm1', sessionId: 'warm1', carId: 'porsche911' }, { id: 'warm2', sessionId: 'warm2', carId: 'porsche911' }])
  warmup.dispose()
  backend = createBackend({ origins: [origin], maxRooms: 4, authenticate: async token => ({ id: token, handle: token, displayName: `Verified ${token}`, expiresAt: Date.now() + 60_000 }),
    raceFactory: { ...factory, create: async racers => {
      const sim = await factory.create(racers)
      return { ...sim, dispose: () => { disposed(); sim.dispose() } }
    } } })
  await backend.listen(0, '127.0.0.1')
  const address = backend.gameServer.transport.server!.address()
  endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
}, 30_000)
afterAll(async () => {
  await Promise.all(clients.filter(c => c.connection.isOpen).map(c => c.leave().catch(() => {})))
  await backend?.gameServer.gracefullyShutdown(false)
})
async function admission(player: string, action: 'create' | 'join', code = '') {
  return fetch(`${endpoint}/rooms`, { method: 'POST', headers: { Origin: origin, Authorization: `Bearer ${player}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol: LOBBY_PROTOCOL, action, code, carId: 'porsche911' }) })
}
async function connect(player: string, action: 'create' | 'join', code = '') {
  const response = await admission(player, action, code)
  expect(response.status).toBe(200)
  const room = await new Client(endpoint).consumeSeatReservation(await response.json())
  clients.push(room)
  frames.set(room.sessionId, new Map())
  room.onMessage('lobby', (s: LobbySnapshot) => lobby.set(room.sessionId, s))
  room.onMessage('race', (s: RaceSnapshot) => frames.get(room.sessionId)!.set(s.tick, s))
  room.onMessage('notice', () => {})
  room.send('sync')
  await vi.waitFor(() => expect(lobby.has(room.sessionId)).toBe(true))
  return room
}
const current = (room: Room) => lobby.get(room.sessionId)!
const ack = (room: Room) => {
  const race = current(room).race!
  room.send('loaded', { protocol: 3, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: race.simulationVersion })
}
it('runs a server-authoritative two-client grid/countdown/input/snapshot lifecycle using shipped physics', async () => {
  const host = await connect('racer1', 'create')
  const code = current(host).code
  const guest = await connect('racer2', 'join', code)
  expect(current(host).raceEnabled).toBe(true)
  host.send('start'); host.send('sync')
  await vi.waitFor(() => expect(current(host).racers).toHaveLength(2))
  expect(current(host).phase).toBe('lobby')
  host.send('ready', true); guest.send('ready', true)
  await vi.waitFor(() => expect(current(host).racers.every(r => r.ready)).toBe(true))
  guest.send('start'); guest.send('sync')
  await vi.waitFor(() => expect(current(guest).phase).toBe('lobby'))
  host.send('start')
  await vi.waitFor(() => expect(current(host).phase).toBe('loading'))
  await vi.waitFor(() => expect(current(guest).race?.id).toBe(current(host).race?.id))
  expect((await admission('late', 'join', code)).status).toBe(409)
  guest.send('laps', 9); guest.send('car', 'diablo'); guest.send('ready', false)
  host.send('loaded', { raceId: current(host).race!.id, fingerprint: 'wrong', simulationVersion: 1 })
  ack(guest)
  host.send('sync')
  await vi.waitFor(() => expect(current(host).phase).toBe('loading'))
  expect(current(host).laps).toBe(3)
  expect(current(host).racers.find(r => r.id === 'racer2')).toMatchObject({ carId: 'porsche911', ready: true })
  ack(host)
  await vi.waitFor(() => expect(current(host).phase).toBe('countdown'))
  await vi.waitFor(() => expect(current(host).phase).toBe('racing'), { timeout: 5000 })
  const raceId = current(host).race!.id
  const latest = [...frames.get(host.sessionId)!.values()].at(-1)!
  expect(latest.vehicles.map(v => v.id)).toEqual(['racer1', 'racer2'])
  const start = latest.vehicles.find(v => v.id === 'racer1')!.position
  // Identity and pose spoofing are rejected, not used as simulation state.
  host.send('input', { raceId, sequence: 0, throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false, id: 'racer2', position: { x: 1e9 } })
  host.send('input', { raceId, sequence: 0, throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false })
  await vi.waitFor(() => expect([...frames.get(host.sessionId)!.values()].some(s => s.vehicles[0].acknowledgedSequence === 0)).toBe(true))
  const accepted = [...frames.get(host.sessionId)!.values()].find(s => s.vehicles[0].acknowledgedSequence === 0)!
  await vi.waitFor(() => expect(frames.get(guest.sessionId)!.get(accepted.tick)).toEqual(accepted))
  expect(accepted.vehicles[1].acknowledgedSequence).toBe(-1)
  for (let seq = 1; seq <= 5; seq++) {
    host.send('input', { raceId, sequence: seq, throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false })
    await new Promise(r => setTimeout(r, 40))
  }
  await vi.waitFor(() => {
    const state = [...frames.get(host.sessionId)!.values()].at(-1)!
    const end = state.vehicles[0].position
    expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeGreaterThan(.1)
    expect(state.vehicles[0].acknowledgedSequence).toBe(5)
  })
  host.send('cancelRace'); host.send('sync')
  await vi.waitFor(() => expect(current(host).phase).toBe('racing'))
  await guest.leave()
  await vi.waitFor(() => expect(current(host).racers).toHaveLength(1))
  expect(current(host)).toMatchObject({ phase: 'racing', race: { id: raceId } })
  expect(disposed).not.toHaveBeenCalled()
  await host.leave()
  await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1))
  // A new room can acquire the sole world after both participants retire.
  const nextHost = await connect('racer1', 'create')
  const replacement = await connect('racer3', 'join', current(nextHost).code)
  nextHost.send('ready', true); replacement.send('ready', true)
  await vi.waitFor(() => expect(current(nextHost).racers.every(r => r.ready)).toBe(true))
  nextHost.send('start')
  await vi.waitFor(() => expect(current(nextHost).phase).toBe('loading'))
  nextHost.send('cancelRace')
  await vi.waitFor(() => expect(current(nextHost)).toMatchObject({ phase: 'lobby', race: null }))
  expect(disposed).toHaveBeenCalledTimes(2)
}, 15_000)
