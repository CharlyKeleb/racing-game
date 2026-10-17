import { describe, expect, it } from 'vitest'
import { CarSoundModel, type CarSoundInput } from '../src/audio/CarSoundModel'

const DT = 1 / 60
const base: CarSoundInput = { rpm: 3000, throttle: 0, gear: 3, nitroActive: false, nitroPerfect: false }

function run(m: CarSoundModel, input: Partial<CarSoundInput>, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) m.update({ ...base, ...input }, DT)
}

describe('CarSoundModel', () => {
  it('spools the turbos with lag under load and bleeds them on lift with a blow-off', () => {
    const m = new CarSoundModel()
    m.update({ ...base, rpm: 6000, throttle: 1 }, DT)
    expect(m.spool).toBeLessThan(0.1) // lag
    run(m, { rpm: 6000, throttle: 1 }, 2)
    expect(m.spool).toBeGreaterThan(0.9)
    m.update({ ...base, rpm: 6000, throttle: 0 }, DT)
    expect(m.blowOff).toBeGreaterThan(0.9)
    m.update({ ...base, rpm: 6000, throttle: 0 }, DT)
    expect(m.blowOff).toBe(0) // one-shot
    run(m, { rpm: 6000, throttle: 0 }, 1)
    expect(m.spool).toBeLessThan(0.05)
  })

  it('no boost and no blow-off at low rpm', () => {
    const m = new CarSoundModel()
    run(m, { rpm: 1800, throttle: 1 }, 2)
    expect(m.spool).toBe(0)
    m.update({ ...base, rpm: 1800, throttle: 0 }, DT)
    expect(m.blowOff).toBe(0)
  })

  it('crackles on overrun after a high-rpm lift, fading out, and stops on throttle', () => {
    const m = new CarSoundModel()
    run(m, { rpm: 6500, throttle: 1 }, 0.5)
    m.update({ ...base, rpm: 6500, throttle: 0 }, DT)
    const peak = m.crackle
    expect(peak).toBeGreaterThan(0.8)
    run(m, { rpm: 3000, throttle: 0 }, 1.5)
    expect(m.crackle).toBeLessThan(peak * 0.4)
    m.crackle = 0.8
    run(m, { rpm: 3000, throttle: 1 }, 0.2)
    expect(m.crackle).toBe(0)
  })

  it('stays quiet when lifting at low rpm', () => {
    const m = new CarSoundModel()
    run(m, { rpm: 2500, throttle: 1 }, 0.5)
    run(m, { rpm: 2500, throttle: 0 }, 0.5)
    expect(m.crackle).toBe(0)
    expect(m.liftOff).toBe(false)
  })

  it('fires the lift-off burble once, with a cooldown', () => {
    const m = new CarSoundModel()
    run(m, { rpm: 6000, throttle: 1 }, 0.3)
    m.update({ ...base, rpm: 6000, throttle: 0 }, DT)
    expect(m.liftOff).toBe(true)
    m.update({ ...base, rpm: 6000, throttle: 1 }, DT)
    m.update({ ...base, rpm: 6000, throttle: 0 }, DT)
    expect(m.liftOff).toBe(false) // cooling down
    run(m, { rpm: 6000, throttle: 1 }, 2.1)
    m.update({ ...base, rpm: 6000, throttle: 0 }, DT)
    expect(m.liftOff).toBe(true)
  })

  it('reports up- and downshifts, not reverse or the first frame', () => {
    const m = new CarSoundModel()
    m.update({ ...base, gear: 1 }, DT)
    expect(m.shiftUp || m.shiftDown).toBe(false)
    m.update({ ...base, gear: 2 }, DT)
    expect(m.shiftUp).toBe(true)
    m.update({ ...base, gear: 2 }, DT)
    expect(m.shiftUp).toBe(false)
    m.update({ ...base, gear: 1 }, DT)
    expect(m.shiftDown).toBe(true)
    m.update({ ...base, gear: -1 }, DT)
    expect(m.shiftDown).toBe(false)
    m.update({ ...base, gear: 1 }, DT)
    expect(m.shiftUp).toBe(false) // out of reverse isn't an upshift
  })

  it('edges for nitro start and perfect boost', () => {
    const m = new CarSoundModel()
    m.update({ ...base, nitroActive: true }, DT)
    expect(m.nitroStart).toBe(true)
    m.update({ ...base, nitroActive: true }, DT)
    expect(m.nitroStart).toBe(false)
    m.update({ ...base, nitroActive: true, nitroPerfect: true }, DT)
    expect(m.perfectStart).toBe(true)
    m.update({ ...base, nitroActive: true, nitroPerfect: true }, DT)
    expect(m.perfectStart).toBe(false)
  })
})
