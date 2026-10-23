import { expect, it, vi } from 'vitest'
import { RaceSession, SERVER_TICK_MS, type RaceFactory } from '../server/src/RaceSession'
import { RACE_PROTOCOL } from '../server/src/protocol'
import { emptyVehicleState } from '../src/multiplayer/SnapshotBuffer'
import { gates, route } from './helpers/raceCourse'

function fixture(options: { guestDelay?: number; laps?: number; stationary?: boolean } = {}) {
  const racers = [{ id: 'one', sessionId: 'a', carId: 'porsche911' as const }, { id: 'two', sessionId: 'b', carId: 'diablo' as const }]
  let step = 0
  const disposed = vi.fn(), inputs = new Map()
  const position = (id: string, out: { x: number; y: number; z: number }) => {
    const tick = step - 180 - (id === 'two' ? options.guestDelay ?? 0 : 0)
    const p = options.stationary || tick <= 0 ? [0, 1] : route[(tick - 1) % route.length]
    out.x = p[0]; out.y = .6; out.z = p[1]
  }
  const factory: RaceFactory = { checkpoints: gates, fingerprint: 'a'.repeat(64), simulationVersion: 1, create: async () => ({
    step: () => { step++ }, position, dispose: disposed, setInput: (id, input) => inputs.set(id, input),
    states: () => racers.map(r => { const state = emptyVehicleState(r.id); position(r.id, state.position); return state }),
  }) }
  const race = new RaceSession(racers, factory, options.laps ?? 1)
  const advance = (ticks: number) => { for (let i = 0; i < ticks; i++) race.advance(SERVER_TICK_MS) }
  const start = async () => {
    await race.load(factory)
    for (const r of racers) race.acknowledge(r.sessionId, { protocol: RACE_PROTOCOL, raceId: race.descriptor.id, fingerprint: factory.fingerprint, simulationVersion: 1 })
    advance(180)
  }
  return { race, start, advance, inputs, disposed, steps: () => step }
}
it('uses the frozen lap count and server ticks, excludes countdown, and holds finished racers', async () => {
  const f = fixture({ guestDelay: 3, laps: 2 }); await f.start()
  f.advance(16)
  expect(f.race.snapshot()?.progress?.[0]).toMatchObject({ completedLaps: 2, finishTicks: 16, lapTicks: [8, 8] })
  expect(f.race.phase).toBe('racing')
  expect(f.race.input('a', { raceId: f.race.descriptor.id, sequence: 0, throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }, 0)).toBe(false)
  f.advance(3)
  expect(f.inputs.get('one')).toMatchObject({ throttle: 0, handbrake: true })
  const result = f.race.snapshot()?.result
  expect(result).toMatchObject({ raceId: f.race.descriptor.id, laps: 2, completedTick: 199, reason: 'all-finished', racers: [
    { id: 'one', rank: 1, finishTicks: 16, lapTicks: [8, 8] }, { id: 'two', rank: 2, finishTicks: 19, lapTicks: [11, 8] },
  ] })
  expect(Object.isFrozen(result?.racers[0].lapTicks)).toBe(true)
  expect(f.disposed).toHaveBeenCalledTimes(1)
  f.advance(1000)
  expect(f.steps()).toBe(199)
  expect(f.race.snapshot()?.result).toBe(result)
  f.race.close('done'); expect(f.race.snapshot()).toBeNull()
  expect(f.disposed).toHaveBeenCalledTimes(1)
})
it('awards equal ranks for finishes on the same server tick', async () => {
  const f = fixture(); await f.start(); f.advance(8)
  expect(f.race.snapshot()?.result?.racers.map(r => r.rank)).toEqual([1, 1])
})
it('marks an unfinished racer DNF after the 60-second finish window', async () => {
  const f = fixture({ guestDelay: 10_000 }); await f.start(); f.advance(8 + 3600)
  expect(f.race.snapshot()?.result).toMatchObject({ reason: 'finish-window', racers: [
    { status: 'finished', rank: 1, finishTicks: 8 }, { status: 'dnf', rank: null, finishTicks: null, lapTicks: [] },
  ] })
})
it('ends a race with no finishers after ten racing minutes without inventing a winner', async () => {
  const f = fixture({ stationary: true }); await f.start(); f.advance(36_000)
  expect(f.race.snapshot()?.result).toMatchObject({ completedTick: 36_180, reason: 'time-limit', racers: [{ status: 'dnf', rank: null }, { status: 'dnf', rank: null }] })
  expect(f.disposed).toHaveBeenCalledTimes(1)
})
it('cancels without a result when the server stalls', async () => {
  const f = fixture(); await f.start(); f.advance(4); f.race.advance(251)
  expect(f.race.phase).toBe('closed')
  expect(f.race.snapshot()).toBeNull()
  expect(f.disposed).toHaveBeenCalledTimes(1)
})
