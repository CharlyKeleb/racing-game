import { beforeAll, expect, it, vi } from 'vitest'
import { PredictionReconciler, MAX_REPLAY_TICKS } from '../src/multiplayer/PredictionReconciler'
import type { CorrectionState } from '../src/multiplayer/CorrectionState'
import { idleCorrectionPhysics } from './helpers/correctionPhysics'
let base: Awaited<ReturnType<typeof idleCorrectionPhysics>>
beforeAll(async () => { base = await idleCorrectionPhysics() })
function correction(tick: number, x = 0): CorrectionState {
  return { ...structuredClone(base), version: 1, raceProtocol: 3, raceId: 'race', racerId: 'one', carId: 'porsche911',
    fingerprint: 'a'.repeat(64), simulationVersion: 1, tick, acknowledgedSequence: -1,
    inputApplication: { mode: 'neutral', firstTick: null, lastTick: null }, body: { ...structuredClone(base.body), position: { x, y: .3, z: 0 } } }
}
const drive = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
function fixture() {
  let x = 0
  const physics = { restore: vi.fn((state: CorrectionState) => { x = state.body.position.x }), step: vi.fn((input: typeof drive) => { x += input.throttle }) }
  const send = vi.fn(() => true), predictor = new PredictionReconciler(physics, send)
  return { physics, send, predictor, x: () => x }
}
it('bootstraps neutral lookahead without emitting a late input burst and then predicts/sends exact future ticks', () => {
  const f = fixture()
  expect(f.predictor.advance(drive, 0)).toBe(false)
  expect(f.predictor.accept(correction(200, 20), 0)).toBe(true)
  expect(f.predictor.predictedTick).toBe(212); expect(f.x()).toBe(20); expect(f.send).not.toHaveBeenCalled()
  expect(f.predictor.advance(drive, 17)).toBe(true)
  expect(f.x()).toBe(21); expect(f.send).toHaveBeenLastCalledWith(213, drive)
  expect(f.predictor.accept(correction(206, 20), 100)).toBe(true)
  expect(f.predictor.predictedTick).toBe(213); expect(f.x()).toBe(21)
  expect(f.send).toHaveBeenCalledTimes(1) // replay does not retransmit or duplicate transport effects
})
it('bounds replay work, resynchronizes missing history, and never invents local race time', () => {
  const f = fixture(); f.predictor.accept(correction(200), 0)
  for (let i = 0; i < MAX_REPLAY_TICKS; i++) f.predictor.advance(drive, i * 10)
  const before = f.physics.step.mock.calls.length
  f.predictor.accept(correction(201, 50), MAX_REPLAY_TICKS * 10)
  expect(f.physics.step.mock.calls.length - before).toBeLessThanOrEqual(MAX_REPLAY_TICKS)
  expect(f.x()).toBe(50); expect(f.predictor.predictedTick).toBe(213) // rebase, not unbounded catch-up
  expect(f.predictor.accept(correction(201), MAX_REPLAY_TICKS * 10 + 1)).toBe(false)
})
it('suspends on stale corrections, backwards time, rejected sends or physics failure until a fresh base', () => {
  const f = fixture(); f.predictor.accept(correction(200), 0)
  expect(f.predictor.advance(drive, 501)).toBe(false); expect(f.predictor.ready).toBe(false)
  expect(f.send).not.toHaveBeenCalled()
  expect(f.predictor.accept(correction(240), 502)).toBe(true)
  expect(f.predictor.advance(drive, 500)).toBe(false)
  f.predictor.accept(correction(246), 503); f.send.mockReturnValueOnce(false)
  expect(f.predictor.advance(drive, 504)).toBe(false)
  f.predictor.accept(correction(252), 505); f.physics.step.mockImplementationOnce(() => { throw new Error('stopped') })
  expect(f.predictor.advance(drive, 506)).toBe(false)
})
it('holds countdown controls, uses no network commands before racing ticks, and caps total session ticks', () => {
  const f = fixture(); f.predictor.accept(correction(150), 0)
  f.predictor.advance(drive, 17)
  expect(f.x()).toBe(0); expect(f.send).not.toHaveBeenCalled()
  expect(f.physics.step).toHaveBeenLastCalledWith(expect.objectContaining({ throttle: 0, handbrake: true }))
  expect(f.predictor.accept(correction(36180), 18)).toBe(true)
  expect(f.predictor.advance(drive, 19)).toBe(false)
})
it('falls back when fresh corrections stop acknowledging scheduled commands', () => {
  const f = fixture(); f.predictor.accept(correction(200), 0)
  expect(f.predictor.advance(drive, 1)).toBe(true)
  // The stream can stay alive even when every outgoing scheduled input is rejected or lost.
  for (let i = 1; i <= 5; i++) {
    expect(f.predictor.accept(correction(200 + i * 6), i * 100)).toBe(true)
    expect(f.predictor.advance(drive, i * 100)).toBe(true)
  }
  expect(f.predictor.accept(correction(236), 502)).toBe(true)
  expect(f.predictor.advance(drive, 502)).toBe(false)
  expect(f.predictor.ready).toBe(false)
})
