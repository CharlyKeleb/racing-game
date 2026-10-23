import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { Client, type Room } from '@colyseus/sdk'
import { createBackend } from '../server/src/server'
import { RACE_PROTOCOL, type LobbySnapshot, type RaceSnapshot } from '../server/src/protocol'
import { scriptedRaceFactory } from './helpers/scriptedRaceFactory'
let backend: ReturnType<typeof createBackend>, endpoint: string
const clients: Room[] = [], lobbies = new Map<string, LobbySnapshot>(), frames = new Map<string, RaceSnapshot>()
const dispose = vi.fn()
beforeAll(async () => {
  backend = createBackend({ origins: ['http://localhost:5173'], maxRooms: 2,
    raceFactory: scriptedRaceFactory(dispose), authenticate: async id => ({ id, handle: id, displayName: id, expiresAt: Date.now() + 60_000 }) })
  await backend.listen(0, '127.0.0.1')
  const address = backend.gameServer.transport.server!.address()
  endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})
afterAll(async () => {
  await Promise.all(clients.filter(c => c.connection.isOpen).map(c => c.leave().catch(() => {})))
  await backend?.gameServer.gracefullyShutdown(false)
})
async function join(id: string, code?: string) {
  const response = await fetch(`${endpoint}/rooms`, { method: 'POST', headers: { Origin: 'http://localhost:5173', Authorization: `Bearer ${id}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ carId: 'porsche911', protocol: 1, action: code ? 'join' : 'create', code }) })
  expect(response.status).toBe(200)
  const client = await new Client(endpoint).consumeSeatReservation(await response.json()); clients.push(client)
  client.onMessage('lobby', (s: LobbySnapshot) => lobbies.set(id, s))
  client.onMessage('race', (s: RaceSnapshot) => frames.set(id, s))
  client.onMessage('notice', () => {})
  client.send('sync')
  await vi.waitFor(() => expect(lobbies.has(id)).toBe(true))
  return client
}
it('delivers identical final results, retains them for sync, and lets only the host return to the lobby', async () => {
  const host = await join('one'), guest = await join('two', lobbies.get('one')!.code)
  host.send('laps', 2)
  await vi.waitFor(() => expect(lobbies.get('two')?.laps).toBe(2))
  host.send('ready', true); guest.send('ready', true)
  await vi.waitFor(() => expect(lobbies.get('one')?.racers.every(r => r.ready)).toBe(true))
  host.send('start')
  await vi.waitFor(() => expect(lobbies.get('two')?.race).toBeTruthy())
  const race = lobbies.get('two')!.race!
  for (const c of clients) c.send('loaded', { protocol: RACE_PROTOCOL, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: 1 })
  await vi.waitFor(() => expect(lobbies.get('one')?.phase).toBe('racing'), { timeout: 5000 })
  // Unknown finish/lap messages cannot create a result.
  guest.send('input', { raceId: race.id, sequence: 0, throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, finishTicks: 1 })
  guest.send('returnLobby')
  await vi.waitFor(() => expect(frames.get('two')?.result).toBeTruthy(), { timeout: 3000 })
  const final = frames.get('two')!
  await vi.waitFor(() => expect(frames.get('one')).toEqual(final))
  expect(final.result).toMatchObject({ laps: 2, reason: 'all-finished', racers: [{ id: 'one', rank: 1 }, { id: 'two', rank: 2 }] })
  expect(final.vehicles.every(v => v.acknowledgedSequence === -1)).toBe(true)
  expect(dispose).toHaveBeenCalledTimes(1)
  guest.send('returnLobby'); host.send('cancelRace'); host.send('sync')
  await vi.waitFor(() => expect(lobbies.get('one')?.phase).toBe('finished'))
  frames.delete('two'); guest.send('sync')
  await vi.waitFor(() => expect(frames.get('two')).toEqual(final))
  host.send('returnLobby')
  await vi.waitFor(() => expect(lobbies.get('two')).toMatchObject({ phase: 'lobby', race: null }))
  expect(lobbies.get('two')?.racers.every(r => !r.ready)).toBe(true)
  expect(dispose).toHaveBeenCalledTimes(1)
}, 12_000)
