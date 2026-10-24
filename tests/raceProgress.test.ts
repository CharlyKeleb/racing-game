import { describe, expect, it } from 'vitest'
import { RaceProgress } from '../server/src/RaceProgress'
import { gates, route } from './helpers/raceCourse'
const point = (x: number, z: number, y = .6) => ({ x, y, z })
describe('authoritative practice checkpoint rules', () => {
  it('requires each ordered gate and a full circuit before crediting each lap', () => {
    const p = new RaceProgress(gates, 2)
    p.seed(point(0, 1))
    let tick = 0
    for (let lap = 0; lap < 2; lap++) {
      for (const [x, z] of route) p.update(point(x, z), ++tick)
      expect(p.lapTicks).toEqual(Array(lap + 1).fill(8))
      expect(p.finishTicks).toBe(lap === 0 ? null : 16)
    }
    p.update(point(1e9, 1e9), 100)
    expect(p.finishTicks).toBe(16)
  })
  it('rejects a start-line shortcut, reverse crossing, distant crossing and elevated crossing', () => {
    const p = new RaceProgress(gates, 1)
    p.seed(point(0, -1)); p.update(point(0, 1), 1)
    expect(p.nextCheckpoint).toBe(1)
    p.seed(point(0, 5)); p.update(point(0, 3), 2)
    expect(p.nextCheckpoint).toBe(1)
    p.seed(point(3, 3)); p.update(point(3, 5), 3)
    expect(p.nextCheckpoint).toBe(1)
    p.seed(point(0, 3, 7)); p.update(point(0, 5, 7), 4)
    expect(p.nextCheckpoint).toBe(1)
    p.seed(point(0, 3)); p.update(point(0, 5), 5)
    expect(p.nextCheckpoint).toBe(2)
    expect(p.lapTicks).toEqual([])
  })
  it('checks the swept intersection inside the gate even when endpoints are outside its radius', () => {
    const p = new RaceProgress(gates, 1)
    p.seed(point(1.9, 2.5)); p.update(point(1.9, 5.5), 1)
    expect(p.nextCheckpoint).toBe(2)
  })
  it('fails closed on invalid course data or discontinuous/nonfinite physics', () => {
    expect(() => new RaceProgress([], 1)).toThrow()
    expect(() => new RaceProgress(gates, 0)).toThrow()
    expect(() => new RaceProgress([{ ...gates[0], radius: NaN }, gates[1]], 1)).toThrow()
    const p = new RaceProgress(gates, 1)
    p.seed(point(0, 1))
    expect(() => p.update(point(0, 6), 1)).toThrow('Discontinuous')
    expect(() => p.update(point(NaN, 1), 1)).toThrow()
    expect(p.lapTicks).toEqual([])
  })
})
