import { expect, it, vi } from 'vitest'
import { RaceSession, SERVER_TICK_MS, type RaceFactory, type ServerRaceSimulation } from '../server/src/RaceSession'
import { emptyVehicleState } from '../src/multiplayer/SnapshotBuffer'
function fixture(enabled = true) {
  const inputs = new Map<string, unknown>(), sim: ServerRaceSimulation = { setInput: (id, value) => { inputs.set(id, { ...value }) },
    position: (_id, out) => Object.assign(out, { x: 0, y: 0, z: 0 }), states: () => ['one', 'two'].map(emptyVehicleState),
    step: vi.fn(), correction: () => ({ body: {} as never, controller: {} }), dispose: vi.fn() }
  const factory: RaceFactory = { correctionVersion: 1, ...(enabled ? { scheduledInputVersion: 1 as const } : {}),
    fingerprint: 'a'.repeat(64), simulationVersion: 1, checkpoints: [{ index: 0, position: [0, 0, 0], tangent: [0, 0, 1], radius: 10 },
      { index: 1, position: [0, 0, 100], tangent: [0, 0, 1], radius: 10 }], create: async () => sim }
  const race = new RaceSession([{ id: 'one', sessionId: 'a', carId: 'porsche911' }, { id: 'two', sessionId: 'b', carId: 'diablo' }], factory)
  const start = async () => { await race.load(factory); for (const session of ['a', 'b']) race.acknowledge(session, { protocol: 3,
    raceId: race.descriptor.id, fingerprint: factory.fingerprint, simulationVersion: 1 }); for (let i = 0; i < 180; i++) race.advance(SERVER_TICK_MS) }
  const command = (sequence: number, tick: number, extra = {}) => ({ version: 1, raceId: race.descriptor.id, sequence, tick,
    throttle: 1, brake: 0, steer: -.3, nitro: true, handbrake: false, ...extra })
  return { race, inputs, sim, start, command }
}
it('applies controls once at their exact server tick, neutralizes gaps and never advances from packets', async () => {
  const f = fixture(); await f.start()
  try {
    expect(f.race.scheduledInput('a', f.command(0, 182), 0)).toBe(true)
    expect(f.race.scheduledInput('a', f.command(1, 184, { steer: .8 }), 1)).toBe(true)
    expect(f.race.tick).toBe(180); expect(f.sim.step).toHaveBeenCalledTimes(180)
    f.race.advance(SERVER_TICK_MS); expect(f.inputs.get('one')).toMatchObject({ throttle: 0 })
    f.race.advance(SERVER_TICK_MS); expect(f.inputs.get('one')).toMatchObject({ throttle: 1, nitro: true, steer: -.3 })
    expect(f.race.snapshot()!.vehicles[0]).toMatchObject({ acknowledgedSequence: 0, inputApplication: { firstTick: 182, lastTick: 182, mode: 'command' } })
    f.race.advance(SERVER_TICK_MS); expect(f.inputs.get('one')).toMatchObject({ throttle: 0, nitro: false })
    f.race.advance(SERVER_TICK_MS); expect(f.inputs.get('one')).toMatchObject({ steer: .8 })
    expect(f.race.snapshot()!.vehicles[0].acknowledgedSequence).toBe(1)
    f.race.advance(SERVER_TICK_MS); expect(f.inputs.get('one')).toMatchObject({ throttle: 0 })
  } finally { f.race.close('done') }
})
it('rejects late/far/rewritten ticks, malformed controls, stale races and mixed mailbox commands', async () => {
  const f = fixture(); await f.start()
  try {
    for (const extra of [{ tick: 180 }, { tick: 205 }, { tick: NaN }, { tick: 181.5 }, { raceId: 'old' },
      { throttle: 2 }, { version: 2 }, { position: { x: 0 } }, { sequence: 200 }]) expect(f.race.scheduledInput('a', f.command(0, 181, extra), 0)).toBe(false)
    expect(f.race.scheduledInput('a', f.command(0, 181), 1000)).toBe(true)
    expect(f.race.scheduledInput('a', f.command(1, 181), 1000)).toBe(false)
    const { tick: _tick, version: _version, ...mailbox } = f.command(1, 182)
    expect(f.race.input('a', mailbox, 1010)).toBe(false)
    expect(f.race.scheduledInput('other', f.command(1, 182), 1010)).toBe(false)
    expect(f.race.scheduledInput('b', f.command(0, 182), 1010)).toBe(true)
  } finally { f.race.close('done') }
})
it('clears scheduled commands on loss/recovery and explicit fallback without rewinding sequence or car state', async () => {
  const f = fixture(); await f.start()
  try {
    f.race.scheduledInput('a', f.command(0, 182), 0)
    f.race.setConnected('a', false); f.race.setConnected('a', true)
    f.race.advance(SERVER_TICK_MS * 2); expect(f.inputs.get('one')).toMatchObject({ throttle: 0 })
    expect(f.race.nextInputSequence('a')).toBe(1)
    f.race.scheduledInput('a', f.command(1, 184), 10)
    expect(f.race.useMailbox('a', { version: 1, raceId: f.race.descriptor.id, mode: 'mailbox' })).toBe(true)
    f.race.advance(SERVER_TICK_MS * 2); expect(f.inputs.get('one')).toMatchObject({ throttle: 0 })
    const { tick: _tick, version: _version, ...mailbox } = f.command(2, 185)
    expect(f.race.input('a', mailbox, 20)).toBe(true)
    f.race.advance(SERVER_TICK_MS); expect(f.inputs.get('one')).toMatchObject({ throttle: 1 })
    expect(f.sim.dispose).not.toHaveBeenCalled()
  } finally { f.race.close('done') }
})
it('leaves the legacy path unchanged without an advertised scheduled-input version', async () => {
  const f = fixture(false); await f.start()
  try { expect(f.race.descriptor.scheduledInputVersion).toBeUndefined(); expect(f.race.scheduledInput('a', f.command(0, 181), 0)).toBe(false) }
  finally { f.race.close('done') }
})
it('bounds high-rate scheduling while simulation still executes only its own fixed ticks', async () => {
  const f = fixture(); await f.start()
  try {
    for (let sequence = 0; sequence < 72; sequence++) {
      expect(f.race.scheduledInput('a', f.command(sequence, f.race.tick + 1), 0)).toBe(true)
      f.race.advance(SERVER_TICK_MS)
    }
    expect(f.race.scheduledInput('a', f.command(72, f.race.tick + 1), 0)).toBe(false)
    expect(f.race.nextInputSequence('a')).toBe(72)
    expect(f.race.scheduledInput('a', f.command(72, f.race.tick + 1), 1000)).toBe(true)
  } finally { f.race.close('done') }
})
