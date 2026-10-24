import { beforeAll, expect, it, vi } from 'vitest'
import { LobbyRoom } from '../server/src/LobbyRoom'
type Client = Parameters<LobbyRoom['onJoin']>[0]
import { RaceSession, SERVER_TICK_MS, type RaceFactory, type ServerRaceSimulation } from '../server/src/RaceSession'
import { CORRECTION_INTERVAL_TICKS, MAX_CORRECTION_BYTES } from '../server/src/protocol'
import { emptyVehicleState } from '../src/multiplayer/SnapshotBuffer'
import { idleCorrectionPhysics } from './helpers/correctionPhysics'
import { decodeCorrectionJson } from '../src/multiplayer/CorrectionState'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import { createRaceFactory, type SimulationBundle } from '../scripts/multiplayer/race-factory'
let physics: Awaited<ReturnType<typeof idleCorrectionPhysics>>
beforeAll(async () => { physics = await idleCorrectionPhysics() })
const racers = [{ id: 'one', sessionId: 'a', carId: 'porsche911' as const }, { id: 'two', sessionId: 'b', carId: 'diablo' as const }]
function factoryFixture() {
  const correction = vi.fn(() => structuredClone(physics))
  const sim: ServerRaceSimulation = { setInput: vi.fn(), step: vi.fn(), position: (_id, out) => Object.assign(out, { x: 0, y: 0, z: 0 }),
    states: () => racers.map(r => emptyVehicleState(r.id)), correction, dispose: vi.fn() }
  const factory: RaceFactory = { correctionVersion: 1, fingerprint: 'a'.repeat(64), simulationVersion: 1,
    checkpoints: [{ index: 0, position: [0, 0, 0], tangent: [0, 0, 1], radius: 10 }, { index: 1, position: [0, 0, 100], tangent: [0, 0, 1], radius: 10 }],
    create: async () => sim }
  return { factory, sim, correction }
}
it('captures only the requested connected seat, binds provenance, and bounds failure/size without killing physics', async () => {
  const f = factoryFixture(), race = new RaceSession(racers, f.factory)
  try {
    await race.load(f.factory)
    for (const r of racers) race.acknowledge(r.sessionId, { protocol: 3, raceId: race.descriptor.id, fingerprint: f.factory.fingerprint, simulationVersion: 1 })
    expect(race.correction('a')).toBeNull()
    race.advance(SERVER_TICK_MS)
    const json = race.correction('a')!
    expect(Buffer.byteLength(json)).toBeLessThan(MAX_CORRECTION_BYTES)
    expect(JSON.parse(json)).toMatchObject({ version: 1, raceId: race.descriptor.id, racerId: 'one', carId: 'porsche911', tick: 1, acknowledgedSequence: -1 })
    expect(f.correction).toHaveBeenLastCalledWith('one')
    const count = f.correction.mock.calls.length
    expect(race.correction('unknown')).toBeNull(); race.setConnected('a', false)
    expect(race.correction('a')).toBeNull(); expect(f.correction).toHaveBeenCalledTimes(count)
    f.correction.mockImplementationOnce(() => { throw new Error('private failure') })
    expect(race.correction('b')).toBeNull()
    f.correction.mockReturnValueOnce({ ...physics, controller: 'x'.repeat(MAX_CORRECTION_BYTES) } as never)
    expect(race.correction('b')).toBeNull(); expect(race.phase).toBe('countdown')
  } finally { race.close('done') }
})
it('does not advertise unsupported factories and rejects advertised support without an adapter', async () => {
  const f = factoryFixture(); delete f.factory.correctionVersion
  const legacy = new RaceSession(racers, f.factory)
  try { await legacy.load(f.factory); expect(legacy.descriptor.correctionVersion).toBeUndefined(); expect(legacy.correction('a')).toBeNull() }
  finally { legacy.close('done') }
  f.factory.correctionVersion = 1; delete f.sim.correction
  const broken = new RaceSession(racers, f.factory)
  await broken.load(f.factory)
  expect(broken.phase).toBe('closed'); expect(f.sim.dispose).toHaveBeenCalledTimes(2)
})
it('sends private corrections only after strict opt-in, at six-tick intervals, and stops on unsubscribe/leave', async () => {
  const f = factoryFixture(), room = new LobbyRoom(), handlers = new Map<string, (client: Client, value?: unknown) => void>()
  let advance!: (dt: number) => void
  vi.spyOn(room, 'setPrivate').mockResolvedValue(undefined as never)
  vi.spyOn(room, 'lock').mockResolvedValue(undefined as never); vi.spyOn(room, 'unlock').mockResolvedValue(undefined as never)
  vi.spyOn(room, 'broadcast').mockImplementation(() => {})
  vi.spyOn(room, 'setSimulationInterval').mockImplementation(((callback: (dt: number) => void) => { advance = callback }) as never)
  vi.spyOn(room, 'onMessage').mockImplementation(((type: string, callback: (client: Client, value: unknown) => void) => { handlers.set(type, callback) }) as never)
  const clients = racers.map(r => ({ sessionId: r.sessionId, send: vi.fn(), auth: { ...r, handle: 'racer_' + r.id, displayName: r.id,
    expiresAt: Date.now() + 60_000 } }) as unknown as Client)
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
  try {
    room.onCreate({ raceFactory: f.factory })
    for (const client of clients) { room.clients.push(client); room.onJoin(client, { carId: 'porsche911' }); handlers.get('ready')!(client, true) }
    handlers.get('start')!(clients[0])
    await vi.waitFor(() => expect(room.snapshot().race).not.toBeNull())
    const race = room.snapshot().race!
    for (const client of clients) handlers.get('loaded')!(client, { protocol: 3, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: 1 })
    for (let tick = 0; tick < 12; tick++) advance(SERVER_TICK_MS)
    expect(f.correction).not.toHaveBeenCalled()
    const request = { version: 1, raceId: race.id, subscriptionId: 1, enabled: true }
    for (const extra of [{ racerId: 'two' }, { raceId: 'old' }, { version: 2 }, { subscriptionId: -1 }, { enabled: 1 }]) {
      clock.mockReturnValue(clock() + 1000); handlers.get('corrections')!(clients[0], { ...request, ...extra })
    }
    advance(SERVER_TICK_MS); expect(f.correction).not.toHaveBeenCalled()
    clock.mockReturnValue(clock() + 1000); handlers.get('corrections')!(clients[0], request)
    advance(SERVER_TICK_MS) // first subscribed send may follow the already elapsed interval
    const received = () => (clients[0].send as ReturnType<typeof vi.fn>).mock.calls.filter(args => args[0] === 'correction')
    expect(received()).toHaveLength(1)
    expect(received()[0][1]).toMatchObject({ subscriptionId: 1 })
    expect(JSON.parse(received()[0][1].state).racerId).toBe('one')
    expect((clients[1].send as ReturnType<typeof vi.fn>).mock.calls.some(args => args[0] === 'correction')).toBe(false)
    for (let tick = 0; tick < CORRECTION_INTERVAL_TICKS - 1; tick++) advance(SERVER_TICK_MS)
    expect(received()).toHaveLength(1); advance(SERVER_TICK_MS); expect(received()).toHaveLength(2)
    handlers.get('corrections')!(clients[0], { ...request, subscriptionId: 2 })
    handlers.get('corrections')!(clients[1], { ...request, subscriptionId: 4 })
    handlers.get('corrections')!(clients[0], { ...request, enabled: false }) // stale stop cannot cancel a newer stream
    for (let tick = 0; tick < 6; tick++) advance(SERVER_TICK_MS)
    expect(received().at(-1)![1].subscriptionId).toBe(2)
    const rivalFrames = (clients[1].send as ReturnType<typeof vi.fn>).mock.calls.filter(args => args[0] === 'correction')
    expect(rivalFrames).toHaveLength(1); expect(JSON.parse(rivalFrames[0][1].state).racerId).toBe('two')
    expect(received().every(args => JSON.parse(args[1].state).racerId === 'one')).toBe(true)
    handlers.get('corrections')!(clients[0], { ...request, subscriptionId: 2, enabled: false })
    const count = received().length
    for (let tick = 0; tick < 12; tick++) advance(SERVER_TICK_MS)
    expect(received()).toHaveLength(count)
    handlers.get('corrections')!(clients[0], { ...request, subscriptionId: 3 })
    const expired = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_001)
    for (let tick = 0; tick < 6; tick++) advance(SERVER_TICK_MS)
    expect(received()).toHaveLength(count) // expired credentials cannot stream while the expiry callback is delayed
    handlers.get('corrections')!(clients[0], { ...request, subscriptionId: 4 })
    for (let tick = 0; tick < 6; tick++) advance(SERVER_TICK_MS)
    expect(received()).toHaveLength(count)
    expired.mockRestore()
    room.onLeave(clients[0], 4000)
    for (let tick = 0; tick < 6; tick++) advance(SERVER_TICK_MS)
    expect(received()).toHaveLength(count)
  } finally { room.onDispose(); room.clock.clear(); vi.restoreAllMocks() }
})
it('captures a real headless adapter state that passes the full bound decoder', async () => {
  const bundle: SimulationBundle = { format: 1, fingerprint: 'a'.repeat(64),
    cars: Object.fromEntries(['porsche911', 'koenigsegg', 'bmw', 'diablo', 'amg', 'charger'].map(id => [id, DEFAULT_VEHICLE_CONFIG])) as SimulationBundle['cars'],
    track: { id: 'nurburgring', spawn: { position: { x: 0, y: 0, z: 0 }, heading: 0 },
      line: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 100 }, { x: 100, y: 0, z: 100 }, { x: 100, y: 0, z: 0 }],
      checkpoints: factoryFixture().factory.checkpoints.map(g => ({ ...g, position: [...g.position] as [number, number, number], tangent: [...g.tangent] as [number, number, number] })), surface: null,
      meshes: [{ vertices: [-1000, 0, -1000, -1000, 0, 1000, 1000, 0, 1000, 1000, 0, -1000], indices: [0, 1, 2, 0, 2, 3], barrier: false }] } }
  const factory = createRaceFactory(bundle), race = new RaceSession(racers, factory)
  try {
    await race.load(factory)
    for (const r of racers) race.acknowledge(r.sessionId, { protocol: 3, raceId: race.descriptor.id, fingerprint: factory.fingerprint, simulationVersion: 1 })
    race.advance(SERVER_TICK_MS)
    const parsed = decodeCorrectionJson(race.correction('a')!, { raceId: race.descriptor.id, racerId: 'one', carId: 'porsche911',
      fingerprint: factory.fingerprint, simulationVersion: 1, afterTick: -1, acknowledgedSequence: -1, maximumSentSequence: -1, config: DEFAULT_VEHICLE_CONFIG })
    expect(parsed).not.toBeNull(); expect(parsed?.controller.wheels).toHaveLength(4)
  } finally { race.close('done') }
})
