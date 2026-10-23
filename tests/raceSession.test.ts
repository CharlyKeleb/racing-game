import { describe, expect, it, vi } from 'vitest'
import { RaceSession, SERVER_TICK_MS, type RaceFactory, type ServerRaceSimulation } from '../server/src/RaceSession'
import type { RaceInput } from '../server/src/protocol'
const racers = [{ id: 'one', sessionId: 'a', carId: 'porsche911' as const }, { id: 'two', sessionId: 'b', carId: 'diablo' as const }]
function fixture(create?: RaceFactory['create']) {
  const inputs = new Map<string, RaceInput>()
  const simulation: ServerRaceSimulation = { step: vi.fn(), position: (_id, out) => { out.x = 0; out.y = 0; out.z = 0 }, setInput: (id, input) => { inputs.set(id, input) }, dispose: vi.fn(),
    states: () => racers.map(r => ({ id: r.id, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, speed: 0, steer: 0, rpm: 900, gear: 1, nitro: 0 })) }
  const factory: RaceFactory = { checkpoints: [{ index: 0, position: [0, 0, 0], tangent: [0, 0, 1], radius: 10 }, { index: 1, position: [0, 0, 10], tangent: [0, 0, 1], radius: 10 }], fingerprint: 'a'.repeat(64), simulationVersion: 1, create: create ?? (async () => simulation) }
  const race = new RaceSession(racers, factory)
  const ack = (sessionId: string) => race.acknowledge(sessionId, { protocol: 2, raceId: race.descriptor.id, fingerprint: factory.fingerprint, simulationVersion: 1 })
  const drive = (sequence: number, extra = {}): RaceInput => ({ raceId: race.descriptor.id, sequence, throttle: 1, brake: 0, steer: .3, handbrake: false, nitro: false, ...extra })
  const start = async () => { await race.load(factory); ack('a'); ack('b'); for (let i = 0; i < 180; i++) race.advance(SERVER_TICK_MS) }
  return { race, factory, simulation, inputs, ack, drive, start }
}
describe('server-owned race session', () => {
  it('waits for both asset acknowledgements and the server simulation, then holds controls for exactly 180 ticks', async () => {
    let resolve!: (sim: ServerRaceSimulation) => void
    const f = fixture(() => new Promise(r => { resolve = r }))
    const loading = f.race.load(f.factory)
    expect(f.ack('a')).toBe(true)
    expect(f.ack('b')).toBe(true)
    expect(f.race.phase).toBe('loading')
    resolve(f.simulation); await loading
    expect(f.race.phase).toBe('countdown')
    expect(f.race.input('a', f.drive(0), 0)).toBe(false)
    for (let i = 0; i < 179; i++) f.race.advance(SERVER_TICK_MS)
    expect(f.race.snapshot()).toMatchObject({ phase: 'countdown', tick: 179, countdownTicks: 1 })
    expect(f.inputs.get('one')).toMatchObject({ throttle: 0, handbrake: true })
    f.race.advance(SERVER_TICK_MS)
    expect(f.race.snapshot()).toMatchObject({ phase: 'racing', tick: 180, countdownTicks: 0 })
    expect(f.race.snapshot()?.vehicles[0].acknowledgedSequence).toBe(-1)
    f.race.close('done')
  })
  it('rejects wrong identities, assets, races, transforms, invalid controls and stale or extreme sequences', async () => {
    const f = fixture()
    expect(f.race.acknowledge('a', { protocol: 2, raceId: f.race.descriptor.id, fingerprint: 'wrong', simulationVersion: 1 })).toBe(false)
    expect(f.race.acknowledge('a', { protocol: 999, raceId: f.race.descriptor.id, fingerprint: f.factory.fingerprint, simulationVersion: 1 })).toBe(false)
    expect(f.race.acknowledge('a', { protocol: 1, raceId: f.race.descriptor.id, fingerprint: f.factory.fingerprint, simulationVersion: 1 })).toBe(false)
    expect(f.ack('other')).toBe(false)
    await f.start()
    for (const extra of [{ throttle: NaN }, { brake: 2 }, { steer: Infinity }, { sequence: -1 }, { sequence: 999999 }, { id: 'two' }, { position: { x: 9 } }, { steerSource: 'fake' }, { raceId: 'old' }, { handbrake: 1 }]) {
      expect(f.race.input('a', f.drive(0, extra), 0)).toBe(false)
    }
    expect(f.race.input('other', f.drive(0), 0)).toBe(false)
    expect(f.race.input('a', f.drive(0), 0)).toBe(true)
    expect(f.race.input('a', f.drive(0), 0)).toBe(false)
    expect(f.race.snapshot()?.vehicles[0].acknowledgedSequence).toBe(-1)
    f.race.advance(SERVER_TICK_MS)
    expect(f.race.snapshot()?.vehicles[0].acknowledgedSequence).toBe(0)
    expect(f.inputs.get('two')).toMatchObject({ throttle: 0 })
    f.race.close('done')
  })
  it('copies commands, keeps one pending input, and clears held throttle/nitro after 250ms without packets', async () => {
    const f = fixture(); await f.start()
    const input = f.drive(0, { nitro: true })
    f.race.input('a', input, 0); input.throttle = 0
    f.race.advance(SERVER_TICK_MS)
    expect(f.inputs.get('one')).toMatchObject({ throttle: 1, nitro: true })
    f.race.input('a', f.drive(1), 20)
    f.race.input('a', f.drive(2, { steer: -.5 }), 40)
    f.race.advance(SERVER_TICK_MS)
    expect(f.race.snapshot()?.vehicles[0].acknowledgedSequence).toBe(2)
    expect(f.inputs.get('one')).toMatchObject({ steer: -.5 })
    for (let i = 0; i < 15; i++) f.race.advance(SERVER_TICK_MS)
    expect(f.inputs.get('one')).toMatchObject({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false })
    f.race.close('done')
  })
  it('rate-limits inputs without consuming rejected sequence numbers', async () => {
    const f = fixture(); await f.start()
    for (let i = 0; i < 30; i++) expect(f.race.input('a', f.drive(i), i)).toBe(true)
    expect(f.race.input('a', f.drive(30), 500)).toBe(false)
    expect(f.race.input('a', f.drive(30), 1000)).toBe(true)
    f.race.close('done')
  })
  it('bounds catch-up, aborts severe stalls and frees its simulation exactly once', async () => {
    const f = fixture(); await f.start()
    const before = f.race.tick
    f.race.advance(100)
    expect(f.race.tick - before).toBe(5)
    f.race.advance(251)
    expect(f.race.phase).toBe('closed')
    expect(f.race.snapshot()).toBeNull()
    expect(f.simulation.dispose).toHaveBeenCalledTimes(1)
    f.race.close('again')
    expect(f.simulation.dispose).toHaveBeenCalledTimes(1)
  })
  it('times out incomplete loading, disposes late completions and handles load failure', async () => {
    let resolve!: (sim: ServerRaceSimulation) => void
    const f = fixture(() => new Promise(r => { resolve = r }))
    const loading = f.race.load(f.factory)
    for (let i = 0; i < 120; i++) f.race.advance(250)
    expect(f.race.phase).toBe('closed')
    resolve(f.simulation); await loading
    expect(f.simulation.dispose).toHaveBeenCalledTimes(1)
    const failed = fixture(async () => { throw new Error('private details') })
    await failed.race.load(failed.factory)
    expect(failed.race.phase).toBe('closed')
    expect(failed.race.reason).not.toContain('private details')
  })
})
