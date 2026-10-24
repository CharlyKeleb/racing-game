import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { idleCorrectionPhysics } from './helpers/correctionPhysics'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import type { RaceDescriptor, CorrectionEnvelope } from '../server/src/protocol'
const sdk = vi.hoisted(() => ({ consume: vi.fn(), reconnect: vi.fn() }))
vi.mock('@colyseus/sdk', () => ({ Client: class { consumeSeatReservation = sdk.consume; reconnect = sdk.reconnect } }))
let physics: Awaited<ReturnType<typeof idleCorrectionPhysics>>
let lobby: typeof import('../src/multiplayer/LobbyClient')
let account: typeof import('../src/stores/accountStore')
beforeAll(async () => { physics = await idleCorrectionPhysics() })
function fakeRoom() {
  return { reconnectionToken: 'test-seat-secret', sessionId: 'seat', reconnection: { enabled: true }, connection: { isOpen: true },
    send: vi.fn(), leave: vi.fn(async () => {}), onMessage: vi.fn<(type: string, handler: (payload: unknown) => void) => void>(), onLeave: vi.fn(), onError: vi.fn() }
}
beforeEach(async () => {
  vi.resetModules(); vi.stubEnv('VITE_MULTIPLAYER_URL', 'http://localhost:2567')
  sdk.consume.mockReset(); sdk.reconnect.mockReset()
  account = await import('../src/stores/accountStore')
  account.accountStore.setState({ status: 'signedIn', player: { id: 'owner', email: null, name: null, avatarUrl: null } })
  lobby = await import('../src/multiplayer/LobbyClient')
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ sessionId: 'seat' })))
})
afterEach(async () => { await lobby.leaveLobby(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
async function fixture() {
  const room = fakeRoom(); sdk.consume.mockResolvedValue(room)
  await lobby.enterLobby('create', '', 'porsche911', async () => 'test-token')
  const handlers = new Map(room.onMessage.mock.calls)
  const race: RaceDescriptor = { protocol: 3, id: 'race-one', fingerprint: 'a'.repeat(64), simulationVersion: 1,
    tickRate: 60, snapshotRate: 20, countdownTicks: 180, correctionVersion: 1 }
  const snapshot = { race, phase: 'countdown', racers: [{ id: 'owner', sessionId: 'seat', carId: 'porsche911' }], reconnectGraceSeconds: 15 }
  handlers.get('lobby')!(snapshot)
  const json = (tick: number, extra: Partial<CorrectionEnvelope> = {}) => JSON.stringify({ ...physics, version: 1, raceProtocol: 3,
    raceId: race.id, racerId: 'owner', carId: 'porsche911', fingerprint: race.fingerprint, simulationVersion: 1,
    tick, acknowledgedSequence: -1, inputApplication: { mode: 'hold', firstTick: null, lastTick: null }, ...extra })
  const subscription = () => room.send.mock.calls.filter(args => args[0] === 'corrections' && args[1].enabled).at(-1)![1].subscriptionId as number
  return { room, handlers, race, snapshot, json, subscription }
}
it('requires advertised/current capability and delivers only fully validated monotonic own-state replies', async () => {
  const f = await fixture(), receive = vi.fn()
  f.handlers.get('lobby')!({ ...f.snapshot, race: { ...f.race, correctionVersion: undefined } })
  lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, receive)
  expect(f.room.send.mock.calls.some(args => args[0] === 'corrections')).toBe(false)
  f.handlers.get('lobby')!(f.snapshot)
  lobby.openCorrectionStream(f.race, 'diablo', DEFAULT_VEHICLE_CONFIG, receive)
  expect(f.room.send.mock.calls.some(args => args[0] === 'corrections')).toBe(false)
  const stop = lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, receive), id = f.subscription()
  const reply = (state: string, subscriptionId = id) => f.handlers.get('correction')!({ subscriptionId, state })
  reply(f.json(6), id + 1); reply('malformed'); reply(f.json(6, { racerId: 'rival' }))
  reply(f.json(6, { acknowledgedSequence: 0, inputApplication: { mode: 'command', firstTick: 6, lastTick: 6 } })) // not sent
  expect(receive).not.toHaveBeenCalled()
  reply(f.json(6)); reply(f.json(6)); reply(f.json(3))
  expect(receive).toHaveBeenCalledTimes(1)
  expect(receive.mock.calls[0][0]).toMatchObject({ tick: 6, racerId: 'owner', controller: physics.controller })
  reply(f.json(12)); expect(receive).toHaveBeenCalledTimes(2)
  stop(); reply(f.json(18)); expect(receive).toHaveBeenCalledTimes(2)
  expect(f.room.send).toHaveBeenLastCalledWith('corrections', { version: 1, raceId: f.race.id, subscriptionId: id, enabled: false })
})
it('isolates subscription replacements and old cleanup functions, then cancels on race change/logout', async () => {
  const f = await fixture(), first = vi.fn(), second = vi.fn()
  const stopFirst = lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, first), firstId = f.subscription()
  lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, second)
  const secondId = f.subscription()
  expect(secondId).not.toBe(firstId)
  stopFirst()
  f.handlers.get('correction')!({ subscriptionId: firstId, state: f.json(6) })
  f.handlers.get('correction')!({ subscriptionId: secondId, state: f.json(6) })
  expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledTimes(1)
  f.handlers.get('lobby')!({ ...f.snapshot, race: { ...f.race, id: 'new-race' } })
  f.handlers.get('correction')!({ subscriptionId: secondId, state: f.json(12) })
  expect(second).toHaveBeenCalledTimes(1)
  f.handlers.get('lobby')!(f.snapshot)
  lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, second)
  const lastId = f.subscription()
  account.accountStore.setState({ player: null })
  f.handlers.get('correction')!({ subscriptionId: lastId, state: f.json(18) })
  expect(second).toHaveBeenCalledTimes(1)
})
it('stops on completed frames and consumer exceptions without disconnecting normal racing', async () => {
  const f = await fixture(), receive = vi.fn(() => { throw new Error('consumer stopped') })
  lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, receive)
  const id = f.subscription()
  f.handlers.get('correction')!({ subscriptionId: id, state: f.json(6) })
  f.handlers.get('correction')!({ subscriptionId: id, state: f.json(12) })
  expect(receive).toHaveBeenCalledTimes(1); expect(lobby.lobbyStore.getState().status).toBe('connected')
  const finished = vi.fn()
  lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, finished)
  const nextId = f.subscription()
  f.handlers.get('race')!({ raceId: f.race.id, tick: 180, phase: 'finished', vehicles: [] })
  f.handlers.get('correction')!({ subscriptionId: nextId, state: f.json(18) })
  expect(finished).not.toHaveBeenCalled()
})
it('drops a stream on socket loss and requires fresh opt-in after authenticated recovery', async () => {
  const f = await fixture(), recovered = fakeRoom(), receive = vi.fn()
  sdk.reconnect.mockResolvedValue(recovered)
  lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, receive)
  const id = f.subscription()
  f.room.connection.isOpen = false; f.room.onLeave.mock.calls[0][0](1006)
  f.handlers.get('correction')!({ subscriptionId: id, state: f.json(6) })
  await vi.waitFor(() => expect(recovered.send).toHaveBeenCalledWith('refresh', 'test-token'))
  const handlers = new Map(recovered.onMessage.mock.calls)
  handlers.get('lobby')!(f.snapshot)
  handlers.get('resumed')!({ raceId: f.race.id, nextInputSequence: 0 })
  expect(recovered.send.mock.calls.some(args => args[0] === 'corrections')).toBe(false)
  handlers.get('correction')!({ subscriptionId: id, state: f.json(12) })
  expect(receive).not.toHaveBeenCalled()
  lobby.openCorrectionStream(f.race, 'porsche911', DEFAULT_VEHICLE_CONFIG, receive)
  const newId = recovered.send.mock.calls.find(args => args[0] === 'corrections')![1].subscriptionId
  handlers.get('correction')!({ subscriptionId: newId, state: f.json(18) })
  expect(receive).toHaveBeenCalledTimes(1)
})
