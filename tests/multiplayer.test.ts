import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { Client, type Room } from '@colyseus/sdk'
import { createBackend } from '../server/src/server'
import { AdmissionError } from '../server/src/auth'
import { activePlayers } from '../server/src/LobbyRoom'
import { LOBBY_PROTOCOL, type LobbySnapshot } from '../server/src/protocol'

let backend: ReturnType<typeof createBackend>
let endpoint: string
const clients: Room[] = []
const states = new Map<string, LobbySnapshot>()
const expires = new Map<string, number>()
const origin = 'http://localhost:5173'
beforeAll(async () => {
  backend = createBackend({ origins: [origin], maxRooms: 5, authenticate: async (token) => {
    if (!/^player[1-8]$/.test(token)) throw new AdmissionError(401, 'Invalid token')
    return { id: token, handle: token, displayName: `Verified ${token}`, expiresAt: expires.get(token) ?? Date.now() + 60_000 }
  } })
  await backend.listen(0, '127.0.0.1')
  const address = backend.gameServer.transport.server!.address()
  endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})
afterAll(async () => { await Promise.all(clients.filter((client) => client.connection.isOpen).map((client) => client.leave().catch(() => {}))); await backend.gameServer.gracefullyShutdown(false) })
async function admission(token: string | null, body: Record<string, unknown>, requestOrigin = origin) {
  return fetch(`${endpoint}/rooms`, { method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ protocol: LOBBY_PROTOCOL, carId: 'porsche911', ...body }) })
}
async function connect(token: string, action: 'create' | 'join', code = '') {
  const response = await admission(token, { action, code, id: 'spoofed', handle: 'spoofed' })
  expect(response.status).toBe(200)
  const room = await new Client(endpoint).consumeSeatReservation(await response.json())
  clients.push(room)
  room.onMessage('lobby', (state: LobbySnapshot) => states.set(room.sessionId, state))
  room.onMessage('notice', () => {})
  room.onMessage('refreshed', () => {})
  room.send('sync')
  await vi.waitFor(() => expect(states.has(room.sessionId)).toBe(true))
  return room
}
it('rejects unauthenticated, invalid, wrong-protocol and wrong-origin admission', async () => {
  expect((await admission(null, { action: 'create' })).status).toBe(401)
  expect((await admission('bad', { action: 'create' })).status).toBe(401)
  expect((await admission('player1', { action: 'create', protocol: 999 })).status).toBe(409)
  expect((await admission('player1', { action: 'create' }, 'https://other.example')).status).toBe(403)
  expect((await admission('player1', { action: 'create', carId: 'fake-car' })).status).toBe(400)
})
it('never exposes direct SDK matchmaking or room listing', async () => {
  await expect(new Client(endpoint).create('private_lobby', { id: 'spoofed' })).rejects.toThrow()
  expect((await fetch(`${endpoint}/rooms`)).status).toBe(404)
})
it('synchronizes two racers, enforces host controls, resets readiness, transfers host and rejects duplicates/full rooms', async () => {
  const host = await connect('player1', 'create')
  const code = states.get(host.sessionId)!.code
  expect(states.get(host.sessionId)).toMatchObject({ raceEnabled: false, race: null })
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
  const guest = await connect('player2', 'join', code)
  await vi.waitFor(() => expect(states.get(host.sessionId)?.racers).toHaveLength(2))
  expect(states.get(host.sessionId)).toEqual(states.get(guest.sessionId))
  expect(states.get(host.sessionId)?.racers[0]).toMatchObject({ id: 'player1', handle: 'player1', displayName: 'Verified player1' })
  expect((await admission('player1', { action: 'join', code })).status).toBe(409)
  guest.send('laps', 8)
  guest.send('sync')
  await vi.waitFor(() => expect(states.get(guest.sessionId)?.laps).toBe(3))
  guest.send('ready', true)
  await vi.waitFor(() => expect(states.get(host.sessionId)?.racers.find((r) => r.id === 'player2')?.ready).toBe(true))
  host.send('laps', 5)
  await vi.waitFor(() => expect(states.get(guest.sessionId)?.laps).toBe(5))
  expect(states.get(guest.sessionId)?.racers.every((r) => !r.ready)).toBe(true)
  guest.send('ready', true)
  guest.send('car', 'diablo')
  await vi.waitFor(() => expect(states.get(host.sessionId)?.racers.find((r) => r.id === 'player2')).toMatchObject({ carId: 'diablo', ready: false }))
  await connect('player3', 'join', code)
  await connect('player4', 'join', code)
  expect((await admission('player5', { action: 'join', code })).status).toBe(503)
  await host.leave()
  await vi.waitFor(() => expect(states.get(guest.sessionId)?.hostId).toBe('player2'))
  expect(activePlayers.has('player1')).toBe(false)
  await Promise.all(clients.filter((client) => client.connection.isOpen).map((client) => client.leave().catch(() => {})))
})
it('allows only one simultaneous admission per verified player', async () => {
  const responses = await Promise.all([admission('player6', { action: 'create' }), admission('player6', { action: 'create' })])
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
})
it('removes expired sessions and stops new admission while draining', async () => {
  expires.set('player7', Date.now() + 1200)
  const expiring = await connect('player7', 'create')
  await new Promise<void>((resolve) => expiring.onLeave(() => resolve()))
  await vi.waitFor(() => expect(activePlayers.has('player7')).toBe(false))
  backend.drain()
  expect((await fetch(`${endpoint}/readyz`)).status).toBe(503)
  expect((await admission('player8', { action: 'create' })).status).toBe(503)
})
