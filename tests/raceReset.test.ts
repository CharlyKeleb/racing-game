import { describe, expect, it } from 'vitest'
import { RaceSession, RESET_BACK_METRES, SERVER_TICK_MS, type RaceFactory, type RaceSpawn, type ServerRaceSimulation } from '../server/src/RaceSession'
import { RESET_INTERVAL_MS } from '../server/src/protocol'
import { RaceProgress } from '../server/src/RaceProgress'
import { createRaceFactory, type SimulationBundle } from '../scripts/multiplayer/race-factory'
// @ts-expect-error Offline exporter is an untyped ES module.
import { buildSimulationAssets } from '../scripts/multiplayer/build-simulation-assets.mjs'
import { gates } from './helpers/raceCourse'

const racers = [{ id: 'one', sessionId: 'a', carId: 'porsche911' as const }, { id: 'two', sessionId: 'b', carId: 'diablo' as const }]
/** Cars move only when a test moves them; respawn records the placement it was given. */
function fixture({ reset = true, respawn = true } = {}) {
  const positions = new Map(racers.map(r => [r.id, { x: 0, y: 0, z: -1 }]))
  const spawns: { id: string; spawn: RaceSpawn }[] = []
  const simulation: ServerRaceSimulation = { step: () => {}, setInput: () => {}, dispose: () => {},
    position: (id, out) => { const p = positions.get(id)!; out.x = p.x; out.y = p.y; out.z = p.z },
    states: () => [],
    ...(respawn ? { respawn: (id: string, spawn: RaceSpawn) => { spawns.push({ id, spawn: { ...spawn } }); positions.set(id, { x: spawn.x, y: spawn.y + .6, z: spawn.z }) } } : {}) }
  const factory: RaceFactory = { ...(reset ? { resetVersion: 1 as const } : {}), checkpoints: gates, fingerprint: 'a'.repeat(64), simulationVersion: 1, create: async () => simulation }
  const race = new RaceSession(racers, factory)
  const message = (extra = {}) => ({ version: 1, raceId: race.descriptor.id, ...extra })
  const tick = (n = 1) => { for (let i = 0; i < n; i++) race.advance(SERVER_TICK_MS) }
  /** Moves a car in sub-4 m steps, one server tick each, as continuous physics would. */
  const drive = (id: string, path: [number, number][]) => {
    for (const [x, z] of path) { positions.set(id, { x, y: 0, z }); tick() }
  }
  const start = async () => {
    await race.load(factory)
    for (const s of ['a', 'b']) race.acknowledge(s, { protocol: 3, raceId: race.descriptor.id, fingerprint: factory.fingerprint, simulationVersion: 1 })
    tick(180)
  }
  const progress = (id: string) => race.snapshot()!.progress!.find(p => p.id === id)!
  return { race, positions, spawns, message, tick, drive, start, progress }
}

describe('online reset to the last counted checkpoint', () => {
  it('is advertised only by factories that support it', () => {
    expect(fixture().race.descriptor.resetVersion).toBe(1)
    expect(fixture({ reset: false }).race.descriptor).not.toHaveProperty('resetVersion')
  })

  it('only resets a connected racer who is still racing, with an exact current-race message', async () => {
    const f = fixture()
    expect(f.race.reset('a', f.message(), 0)).toBe(false) // loading
    await f.start()
    for (const bad of [null, 'reset', [], { raceId: f.race.descriptor.id }, f.message({ version: 2 }), f.message({ raceId: 'old' }), f.message({ position: [0, 0, 0] })]) {
      expect(f.race.reset('a', bad, 0)).toBe(false)
    }
    expect(f.race.reset('other', f.message(), 0)).toBe(false)
    expect(f.race.reset('a', f.message(), NaN)).toBe(false)
    f.race.setConnected('a', false)
    expect(f.race.reset('a', f.message(), 0)).toBe(false)
    f.race.setConnected('a', true)
    expect(f.race.reset('a', f.message(), 0)).toBe(true)
    expect(f.spawns).toHaveLength(1)
    f.race.retire('b', 'left')
    expect(f.race.reset('b', f.message(), 0)).toBe(false)
    f.race.close('done')
  })

  it('rejects resets during the countdown and for servers without the capability or adapter', async () => {
    const early = fixture()
    await early.race.load({ resetVersion: 1, checkpoints: gates, fingerprint: 'a'.repeat(64), simulationVersion: 1, create: async () => ({ step: () => {}, setInput: () => {}, dispose: () => {}, position: (_id, out) => { out.x = 0; out.y = 0; out.z = -1 }, states: () => [], respawn: () => {} }) })
    for (const s of ['a', 'b']) early.race.acknowledge(s, { protocol: 3, raceId: early.race.descriptor.id, fingerprint: 'a'.repeat(64), simulationVersion: 1 })
    early.tick(10)
    expect(early.race.phase).toBe('countdown')
    expect(early.race.reset('a', early.message(), 0)).toBe(false)
    const old = fixture({ reset: false }); await old.start()
    expect(old.race.reset('a', old.message(), 0)).toBe(false)
    const noAdapter = fixture({ respawn: false }); await noAdapter.start()
    expect(noAdapter.race.reset('a', noAdapter.message(), 0)).toBe(false)
    for (const r of [early, old, noAdapter]) r.race.close('done')
  })

  it('places the car before the last counted gate, facing along it, and keeps lap progress', async () => {
    const f = fixture(); await f.start()
    // Through gates 1 and 2 (next is 3), then off course without crossing gate 3.
    f.drive('one', [[0, 1], [0, 3], [0, 5], [3, 5], [5, 5], [7, 5], [9, 5]])
    expect(f.progress('one').nextCheckpoint).toBe(3)
    expect(f.race.reset('a', f.message(), 1000)).toBe(true)
    const { spawn } = f.spawns[0]
    expect(f.spawns[0].id).toBe('one')
    expect(spawn.x).toBeCloseTo(4 - RESET_BACK_METRES)
    expect(spawn.z).toBeCloseTo(5)
    expect(spawn.y).toBe(0)
    expect(spawn.heading).toBeCloseTo(Math.PI / 2) // gate 2's tangent is +X
    expect(f.progress('one').nextCheckpoint).toBe(3)
    // The jump is reseeded: the next tick neither closes the race nor credits a gate.
    f.tick()
    expect(f.race.phase).toBe('racing')
    expect(f.progress('one').nextCheckpoint).toBe(3)
    // Driving back through gate 2 (already counted) and on through gate 3 resumes the lap.
    f.drive('one', [[-1, 5], [1, 5], [3, 5], [5, 5], [5, 3], [5, 1]])
    expect(f.progress('one').nextCheckpoint).toBe(0)
    f.race.close('done')
  })

  it('wraps to the final gate when the next gate is the finish line, and to the start line on the first sector', async () => {
    const f = fixture(); await f.start()
    expect(f.progress('one').nextCheckpoint).toBe(1)
    expect(f.race.reset('a', f.message(), 0)).toBe(true)
    expect(f.spawns[0].spawn).toMatchObject({ x: 0, heading: 0 })
    expect(f.spawns[0].spawn.z).toBeCloseTo(-RESET_BACK_METRES)
    f.drive('one', [[0, -3], [0, -1], [0, 1], [0, 3], [0, 5], [3, 5], [5, 5], [5, 3], [5, 1]])
    expect(f.progress('one').nextCheckpoint).toBe(0)
    expect(f.race.reset('a', f.message(), RESET_INTERVAL_MS)).toBe(true)
    expect(f.spawns[1].spawn.x).toBeCloseTo(5)
    expect(f.spawns[1].spawn.z).toBeCloseTo(2 + RESET_BACK_METRES) // gate 3 faces -Z
    expect(f.spawns[1].spawn.heading).toBeCloseTo(Math.PI)
    f.race.close('done')
  })

  it('rate-limits each racer separately', async () => {
    const f = fixture(); await f.start()
    expect(f.race.reset('a', f.message(), 5000)).toBe(true)
    expect(f.race.reset('a', f.message(), 5000 + RESET_INTERVAL_MS - 1)).toBe(false)
    expect(f.race.reset('b', f.message(), 5001)).toBe(true)
    expect(f.race.reset('a', f.message(), 5000 + RESET_INTERVAL_MS)).toBe(true)
    f.race.close('done')
  })

  it('never resets a racer who has finished', async () => {
    const f = fixture(); await f.start()
    const lap: [number, number][] = [[0, 1], [0, 3], [0, 5], [3, 5], [5, 5], [5, 3], [5, 1], [2, 1], [0, -1], [0, 1]]
    for (let i = 0; i < 3; i++) f.drive('one', lap)
    expect(f.progress('one').finishTicks).not.toBeNull()
    expect(f.race.reset('a', f.message(), 0)).toBe(false)
    f.race.close('done')
  })
})

describe('progress reseed after a respawn', () => {
  it('accepts the jump without a discontinuity and credits nothing for it', () => {
    const p = new RaceProgress(gates, 1)
    p.seed({ x: 0, y: 0, z: -1 }); p.update({ x: 0, y: 0, z: 1 }, 1); p.update({ x: 0, y: 0, z: 3 }, 2); p.update({ x: 0, y: 0, z: 5 }, 3)
    expect(p.nextCheckpoint).toBe(2)
    expect(() => p.update({ x: 4 - 20, y: 0, z: 5 }, 4)).toThrow('Discontinuous')
    p.seed({ x: -2, y: .6, z: 5 })
    p.update({ x: -1, y: .6, z: 5 }, 5)
    expect(p.nextCheckpoint).toBe(2)
    p.update({ x: 1, y: .6, z: 5 }, 6); p.update({ x: 3, y: .6, z: 5 }, 7); p.update({ x: 5, y: .6, z: 5 }, 8)
    expect(p.nextCheckpoint).toBe(3)
    expect(p.lapTicks).toEqual([])
  })
})

describe('server physics respawn', () => {
  it('stops the car upright on the road before the gate, facing along it', async () => {
    const bundle = await buildSimulationAssets() as SimulationBundle
    const factory = createRaceFactory(bundle)
    expect(factory.resetVersion).toBe(1)
    const sim = await factory.create(racers)
    try {
      const gate = bundle.track.checkpoints[3]
      const [tx, , tz] = gate.tangent, length = Math.hypot(tx, tz)
      const heading = Math.atan2(tx, tz)
      sim.respawn!('one', { x: gate.position[0] - tx / length * 6, y: gate.position[1], z: gate.position[2] - tz / length * 6, heading })
      const state = sim.states().find(s => s.id === 'one')!
      expect(Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)).toBe(0)
      expect(Math.hypot(state.position.x - (gate.position[0] - tx / length * 6), state.position.z - (gate.position[2] - tz / length * 6))).toBeLessThan(.01)
      expect(Math.abs(state.position.y - gate.position[1])).toBeLessThan(3)
      for (let i = 0; i < 60; i++) sim.step()
      const settled = sim.states().find(s => s.id === 'one')!
      const q = settled.rotation
      expect(1 - 2 * (q.x * q.x + q.z * q.z)).toBeGreaterThan(.95) // upright
      expect(Math.abs(settled.speed)).toBeLessThan(1)
      expect(Math.abs(settled.position.y - state.position.y)).toBeLessThan(1.5) // landed on the road, not fell through
    } finally { sim.dispose() }
  }, 30_000)
})
