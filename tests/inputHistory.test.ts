import { expect, it } from 'vitest'
import type { InputState } from '../src/input/InputManager'
import { InputHistory } from '../src/multiplayer/InputHistory'
import { Drivetrain } from '../src/vehicles/Drivetrain'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
const input = (): InputState => ({ throttle: .123456789012345, brake: .2, steer: -.3333333333333333, steerSource: 'keyboard', handbrake: true, nitro: true, lookBack: true })
it('copies exact analog controls, reuses fixed ring storage and strips presentation input', () => {
  const history = new InputHistory(3), source = input(), out = input()
  history.reset(100)
  expect(history.record(101, source)).toBe(true)
  source.throttle = 1
  expect(history.copy(101, out)).toBe(true)
  expect(out).toEqual({ ...input(), lookBack: undefined })
  out.steer = 1
  expect(history.copy(101, out)).toBe(true); expect(out.steer).toBe(input().steer)
  expect(history.record(102, { ...source, steerSource: 'analog' })).toBe(true)
  expect(history.discardThrough(101)).toBe(true)
  expect(history.record(103, { ...source, steerSource: undefined })).toBe(true)
  expect(history.record(104, source)).toBe(true) // wraps storage
  expect(history.size).toBe(3); expect(history.oldestTick).toBe(102); expect(history.newestTick).toBe(104)
  expect(history.copy(102, out)).toBe(true); expect(out.steerSource).toBe('analog')
  expect(history.copy(103, out)).toBe(true); expect(out.steerSource).toBeUndefined()
  expect(history.discardThrough(104)).toBe(true); expect(history.size).toBe(0)
  expect(history.record(105, source)).toBe(true)
})
it('fails closed on overflow or missing/duplicate ticks and requires an explicit resync', () => {
  for (const tick of [1, 3, -1, NaN, Infinity, 1.5]) {
    const history = new InputHistory(2); history.reset(0)
    expect(history.record(1, input())).toBe(true)
    expect(history.record(tick, input())).toBe(false)
    expect(history.needsResync).toBe(true)
    expect(history.copy(1, input())).toBe(false)
    history.reset(500)
    expect(history.record(501, input())).toBe(true)
  }
  const history = new InputHistory(1)
  history.record(1, input())
  expect(history.record(2, input())).toBe(false)
  expect(history.size).toBe(1) // no silent overwrite of the missing history
})
it('rejects malformed controls before writing, and future/missing reads cannot mutate caller output', () => {
  for (const change of [{ throttle: NaN }, { brake: -1 }, { steer: 2 }, { steerSource: 'fake' }, { nitro: 1 }, { handbrake: 0 }]) {
    const history = new InputHistory()
    expect(history.record(1, { ...input(), ...change } as InputState)).toBe(false)
    expect(history.size).toBe(0)
  }
  const history = new InputHistory(), out = input(), saved = { ...out }
  history.reset(0); history.record(1, input())
  expect(history.copy(0, out)).toBe(false); expect(history.copy(2, out)).toBe(false)
  expect(out).toEqual(saved)
  expect(history.discardThrough(2)).toBe(false); expect(history.size).toBe(1)
  expect(history.discardThrough(0)).toBe(true); expect(history.size).toBe(1)
  expect(() => new InputHistory(0)).toThrow(); expect(() => new InputHistory(601)).toThrow()
  expect(() => history.reset(Number.MAX_SAFE_INTEGER)).toThrow()
})
it('replays recorded controls after a controller checkpoint and matches uninterrupted gearbox forces', () => {
  const reference = new Drivetrain(DEFAULT_VEHICLE_CONFIG.engine), history = new InputHistory(80)
  const controls = (tick: number): InputState => ({ throttle: tick % 50 < 25 ? .91 : .02, brake: tick % 50 >= 25 ? .8 : 0,
    steer: 0, handbrake: false, nitro: false })
  const step = (box: Drivetrain, tick: number, state: InputState) => box.update(tick * .2, .35, state.throttle, 0, 1 / 60, state.brake)
  for (let tick = 1; tick <= 100; tick++) step(reference, tick, controls(tick))
  const checkpoint = JSON.parse(JSON.stringify(reference.captureState())), outputs: number[] = []
  history.reset(100)
  for (let tick = 101; tick <= 180; tick++) {
    const state = controls(tick)
    expect(history.record(tick, state)).toBe(true)
    outputs.push(step(reference, tick, state))
  }
  const branch = new Drivetrain(DEFAULT_VEHICLE_CONFIG.engine), scratch = input()
  branch.restoreState(checkpoint)
  for (let tick = 101; tick <= 180; tick++) {
    expect(history.copy(tick, scratch)).toBe(true)
    expect(step(branch, tick, scratch)).toBe(outputs[tick - 101])
  }
  expect(branch.captureState()).toEqual(reference.captureState())
})
