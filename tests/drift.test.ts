import { describe, expect, it } from 'vitest'
import { DEFAULT_DRIFT as cfg, Drift, type DriftInput } from '../src/vehicles/Drift'

const DT = 1 / 60
const cruise: DriftInput = { speed: 30, steer: 0, throttle: 0.5, brake: 0, handbrake: false, slipAngle: 0.02, downshift: false }
const run = (d: Drift, i: Partial<DriftInput>, seconds: number) => {
  for (let k = 0; k < Math.round(seconds / DT); k++) d.update({ ...cruise, ...i }, cfg, DT)
}

describe('Drift entries', () => {
  it('ordinary hard cornering is not a drift', () => {
    const d = new Drift()
    run(d, { steer: 1, throttle: 1, speed: 33 }, 2) // full lock at ~120 km/h
    expect(d.active).toBe(false)
  })

  it('fast turn-in: full lock at high speed on the throttle', () => {
    const d = new Drift()
    d.update({ ...cruise, speed: 45, steer: 0.9, throttle: 1 }, cfg, DT)
    expect(d.active).toBe(true)
    expect(d.entry).toBe(1)
    d.update({ ...cruise, speed: 45, steer: 0.9, throttle: 1 }, cfg, DT)
    expect(d.entry).toBe(0) // one-shot
  })

  it('brake-tap: brake, release, then turn in within the arm time', () => {
    const d = new Drift()
    run(d, { brake: 1 }, 0.2)
    expect(d.active).toBe(false) // braking alone isn't a drift
    d.update({ ...cruise }, cfg, DT) // released
    run(d, { steer: -0.7 }, 0.1)
    expect(d.active).toBe(true)
    expect(d.entry).toBe(0)
  })

  it('brake-tap expires if you wait too long to turn', () => {
    const d = new Drift()
    run(d, { brake: 1 }, 0.2)
    run(d, {}, cfg.armTime + 0.1)
    run(d, { steer: 0.8 }, 0.2)
    expect(d.active).toBe(false)
  })

  it('downshift + turn off-throttle kicks the rear out', () => {
    const d = new Drift()
    d.update({ ...cruise, throttle: 0, downshift: true }, cfg, DT)
    run(d, { throttle: 0, steer: 0.75 }, 0.1)
    expect(d.active).toBe(true)
  })

  it('no drifts at low speed', () => {
    const d = new Drift()
    run(d, { brake: 1, speed: 8 }, 0.2)
    run(d, { steer: 1, speed: 8 }, 0.3)
    d.update({ ...cruise, speed: 8, steer: 1, handbrake: true }, cfg, DT)
    expect(d.active).toBe(false)
  })
})

describe('Drift while sliding', () => {
  const sliding = () => {
    const d = new Drift()
    d.update({ ...cruise, speed: 45, steer: 0.9, throttle: 1 }, cfg, DT)
    run(d, { speed: 40, steer: -0.6, throttle: 0.8, slipAngle: 0.5 }, 0.5) // countersteering
    return d
  }

  it('eases in and holds on opposite lock', () => {
    const d = sliding()
    expect(d.active).toBe(true)
    expect(d.amount).toBeGreaterThan(0.95)
  })

  it('throttle loosens the rear: the gas pedal sets the angle', () => {
    const d = sliding()
    expect(d.rearGripScale(1, cfg)).toBeLessThan(d.rearGripScale(0, cfg))
    expect(d.rearGripScale(0, cfg)).toBeLessThan(0.7)
  })

  it('ends when the wheel is straightened, and grip comes back', () => {
    const d = sliding()
    run(d, { speed: 40, steer: 0, throttle: 0.4, slipAngle: 0.4 }, cfg.exitTime + 0.05)
    expect(d.active).toBe(false)
    run(d, { speed: 40 }, 1.5)
    expect(d.amount).toBe(0)
    expect(d.rearGripScale(0.4, cfg)).toBe(1)
  })

  it('ends when the car slows right down', () => {
    const d = sliding()
    run(d, { speed: 6, steer: -0.6, slipAngle: 0.5 }, 0.1)
    expect(d.active).toBe(false)
  })
})
