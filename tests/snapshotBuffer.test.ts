import { describe, expect, it } from 'vitest'
import { SnapshotBuffer, emptyVehicleState } from '../src/multiplayer/SnapshotBuffer'
import type { RaceSnapshot } from '../server/src/protocol'
const frame = (tick: number, x = tick): RaceSnapshot => ({ raceId: 'race', tick, countdownTicks: 0, phase: 'racing', vehicles: [
  { ...emptyVehicleState('one'), position: { x, y: 1, z: 0 }, velocity: { x: 60, y: 0, z: 0 }, acknowledgedSequence: 0 },
  { ...emptyVehicleState('two'), position: { x: -x, y: 1, z: 5 }, acknowledgedSequence: -1 },
] })
describe('online snapshot presentation', () => {
  it('interpolates both car poses behind authoritative time with quaternion shortest-path rotation', () => {
    const b = new SnapshotBuffer('race', ['one', 'two'])
    const a = frame(0), next = frame(12)
    next.vehicles[0].rotation = { x: 0, y: 0, z: 0, w: -1 }
    b.push(a, 0); b.push(next, 200)
    const out = emptyVehicleState('one'), other = emptyVehicleState('two')
    b.sample('one', 200, out); b.sample('two', 200, other)
    expect(out.position.x).toBeCloseTo(6)
    expect(other.position.x).toBeCloseTo(-6)
    expect(Math.abs(out.rotation.w)).toBeCloseTo(1)
  })
  it('bounds velocity extrapolation and freezes through an extended network gap', () => {
    const b = new SnapshotBuffer('race', ['one', 'two']), out = emptyVehicleState('one')
    b.push(frame(12), 200)
    b.sample('one', 2000, out)
    expect(out.position.x).toBeCloseTo(14)
    expect(b.delayed(701)).toBe(true)
    b.sample('one', 9000, out)
    expect(out.position.x).toBeCloseTo(14)
  })
  it('rejects stale, foreign, malformed and nonfinite poses and copies accepted snapshots', () => {
    const b = new SnapshotBuffer('race', ['one', 'two'])
    const source = frame(6)
    expect(b.push(source, 100)).toBe(true)
    source.vehicles[0].position.x = 1e9
    expect(b.latest?.vehicles[0].position.x).toBe(6)
    expect(b.push(frame(3), 110)).toBe(false)
    expect(b.push({ ...frame(9), raceId: 'old' }, 120)).toBe(false)
    const invalid = frame(9); invalid.vehicles[0].position.x = NaN
    expect(b.push(invalid, 130)).toBe(false)
    const duplicate = frame(9); duplicate.vehicles[1].id = 'one'
    expect(b.push(duplicate, 140)).toBe(false)
    expect(b.latest?.tick).toBe(6)
  })
  it('resyncs after a backgrounded tab without replaying its old interpolation history', () => {
    const b = new SnapshotBuffer('race', ['one', 'two']), out = emptyVehicleState('one')
    for (let tick = 0; tick < 300; tick += 3) b.push(frame(tick), tick * 1000 / 60)
    b.resync()
    b.sample('one', 4950, out)
    expect(out.position.x).toBe(297)
    expect(b.delayed(4950)).toBe(false)
  })
})
it('keeps a finished frame at its final pose without reporting a stale connection', () => {
  const b = new SnapshotBuffer('race', ['one', 'two']), out = emptyVehicleState('one')
  b.push(frame(3), 50)
  expect(b.push({ ...frame(6), phase: 'finished' }, 100)).toBe(true)
  b.sample('one', 10_000, out)
  expect(out.position.x).toBe(6)
  expect(b.delayed(10_000)).toBe(false)
})
