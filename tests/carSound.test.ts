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

describe('CarSoundModel: engine as heard', () => {
  it('revs up with inertia instead of jumping (launch from idle)', () => {
    const m = new CarSoundModel()
    m.update({ ...base, rpm: 1000, throttle: 0, gear: 1 }, DT)
    run(m, { rpm: 4500, throttle: 1, gear: 1 }, 0.1)
    expect(m.rpm).toBeGreaterThan(1500)
    expect(m.rpm).toBeLessThan(3200) // not an instant step
    run(m, { rpm: 4500, throttle: 1, gear: 1 }, 0.5)
    expect(m.rpm).toBeCloseTo(4500, -2)
  })

  it('tracks normal in-gear acceleration closely', () => {
    const m = new CarSoundModel()
    let worst = 0
    for (let i = 0; i <= 120; i++) {
      const rpm = 3000 + (3000 * i) / 120 // 1500 rpm/s, a brisk pull
      m.update({ ...base, rpm, throttle: 1, gear: 3 }, DT)
      if (i > 20) worst = Math.max(worst, Math.abs(m.rpm - rpm) / rpm)
    }
    expect(worst).toBeLessThan(0.03)
  })

  it('upshift: ignition cut then the revs fall over ~0.1 s, not in one frame', () => {
    const m = new CarSoundModel()
    run(m, { rpm: 7200, throttle: 1, gear: 2 }, 0.5)
    m.update({ ...base, rpm: 4800, throttle: 1, gear: 3 }, DT)
    expect(m.shiftUp).toBe(true)
    expect(m.rpm).toBeGreaterThan(6200) // no snap
    run(m, { rpm: 4800, throttle: 1, gear: 3 }, 0.02)
    expect(m.cut).toBeGreaterThan(0.5)
    expect(m.load).toBeLessThan(0.6) // note dips during the cut
    run(m, { rpm: 4800, throttle: 1, gear: 3 }, 0.15)
    expect(Math.abs(m.rpm - 4800) / 4800).toBeLessThan(0.05)
    run(m, { rpm: 4800, throttle: 1, gear: 3 }, 0.1)
    expect(m.cut).toBeLessThan(0.1)
    expect(m.load).toBeGreaterThan(0.9)
  })

  it('downshift under braking: rev-match blip overshoots then settles', () => {
    const m = new CarSoundModel()
    run(m, { rpm: 3400, throttle: 0, gear: 4 }, 0.5)
    m.update({ ...base, rpm: 4650, throttle: 0, gear: 3 }, DT)
    expect(m.shiftDown).toBe(true)
    let peak = 0
    let blipLoad = 0
    for (let i = 0; i < Math.round(0.3 / DT); i++) {
      m.update({ ...base, rpm: 4650, throttle: 0, gear: 3 }, DT)
      peak = Math.max(peak, m.rpm)
      blipLoad = Math.max(blipLoad, m.load)
    }
    expect(peak).toBeGreaterThan(4650 * 1.02) // the blip overshoots
    expect(peak).toBeLessThan(4650 * 1.1)
    expect(blipLoad).toBeGreaterThan(0.6) // throttle blip with the foot off
    run(m, { rpm: 4650, throttle: 0, gear: 3 }, 0.6)
    expect(Math.abs(m.rpm - 4650) / 4650).toBeLessThan(0.02)
    expect(m.load).toBeLessThan(0.05)
  })

  it('smooths an on/off keyboard throttle', () => {
    const m = new CarSoundModel()
    run(m, { rpm: 3000, throttle: 0, gear: 3 }, 0.3)
    m.update({ ...base, rpm: 3000, throttle: 1, gear: 3 }, DT)
    expect(m.load).toBeGreaterThan(0.1)
    expect(m.load).toBeLessThan(0.4)
    run(m, { rpm: 3000, throttle: 1, gear: 3 }, 0.25)
    expect(m.load).toBeGreaterThan(0.95)
    m.update({ ...base, rpm: 3000, throttle: 0, gear: 3 }, DT)
    expect(m.load).toBeGreaterThan(0.6) // lifts off gently too
  })

  it('reset starts the heard engine from the next input', () => {
    const m = new CarSoundModel()
    run(m, { rpm: 6000, throttle: 1 }, 0.5)
    m.reset()
    m.update({ ...base, rpm: 900, throttle: 0, gear: 1 }, DT)
    expect(m.rpm).toBe(900)
  })
})
