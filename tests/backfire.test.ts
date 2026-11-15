import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Backfire, BANG, CRACKLE, NONE, type BackfireInput } from '../src/vehicles/Backfire'
import { Nitro } from '../src/vehicles/Nitro'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import { BackfireSound, type BackfireBankIndex } from '../src/audio/BackfireSound'

const DT = 1 / 60
const base: BackfireInput = { throttle: 0, revs: 0.3, gear: 3, burnout: 0, nitroLit: false }

/** Run and collect [time, kind] of every pop. */
function run(b: Backfire, seconds: number, at: (t: number) => Partial<BackfireInput>, from = 0): [number, number][] {
  const pops: [number, number][] = []
  for (let t = from; t < from + seconds - 1e-9; t += DT) {
    b.update(DT, { ...base, ...at(t) })
    if (b.popped !== NONE) pops.push([t, b.popped])
  }
  return pops
}

describe('exhaust backfire', () => {
  it('snapping the throttle shut at high revs crackles in a short burst', () => {
    const b = new Backfire()
    run(b, 1, () => ({ throttle: 1, revs: 0.85 }))
    const pops = run(b, 1.2, () => ({ throttle: 0, revs: 0.8 }), 1)
    const crackles = pops.filter(([, k]) => k === CRACKLE).length
    expect(crackles).toBeGreaterThanOrEqual(2)
    expect(crackles).toBeLessThanOrEqual(5)
    expect(pops.at(-1)![0] - pops[0][0]).toBeLessThan(0.9)
  })

  it('no crackle when lifting at low revs, or easing off slowly', () => {
    const low = new Backfire()
    run(low, 1, () => ({ throttle: 1, revs: 0.35 }))
    expect(run(low, 1, () => ({ throttle: 0, revs: 0.3 }), 1)).toEqual([])
    const gentle = new Backfire()
    run(gentle, 1, () => ({ throttle: 1, revs: 0.85 }))
    expect(run(gentle, 2, (t) => ({ throttle: Math.max(0, 1 - (t - 1)), revs: 0.8 }), 1)).toEqual([])
  })

  it('getting back on the power cuts the crackle short', () => {
    const b = new Backfire()
    run(b, 1, () => ({ throttle: 1, revs: 0.9 }))
    run(b, 0.03, () => ({ throttle: 0, revs: 0.9 }), 1)
    expect(run(b, 1, () => ({ throttle: 1, revs: 0.9 }), 1.03).filter(([, k]) => k === CRACKLE)).toEqual([])
  })

  it('hard upshifts bang (most of the time), lazy ones never do', () => {
    const b = new Backfire()
    let bangs = 0
    for (let shift = 0; shift < 8; shift++) {
      run(b, 0.5, () => ({ throttle: 1, revs: 0.95, gear: 2 }))
      bangs += run(b, DT, () => ({ throttle: 1, revs: 0.95, gear: 3 })).filter(([, k]) => k === BANG).length
      run(b, 0.5, () => ({ throttle: 1, revs: 0.95, gear: 3 }))
      b.reset()
    }
    expect(bangs).toBeGreaterThanOrEqual(4)
    const lazy = new Backfire()
    run(lazy, 0.5, () => ({ throttle: 0.4, revs: 0.5, gear: 2 }))
    expect(run(lazy, DT, () => ({ throttle: 0.4, revs: 0.5, gear: 3 }))).toEqual([])
  })

  it('nitro lighting bangs on that tick; a burnout pops irregularly', () => {
    const b = new Backfire()
    b.update(DT, { ...base, throttle: 1, nitroLit: true })
    expect(b.popped).toBe(BANG)
    expect(b.flash).toBe(1)
    const burn = new Backfire()
    const pops = run(burn, 3, () => ({ throttle: 1, revs: 0.8, gear: 1, burnout: 1 }))
    expect(pops.length).toBeGreaterThan(4)
    const gaps = pops.slice(1).map(([t], i) => t - pops[i][0])
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.05 - 1e-9)
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeGreaterThan(0.1)
  })

  it('the fireball fades out, and the same inputs give the same pops', () => {
    const a = new Backfire(), b = new Backfire()
    const drive = (t: number): Partial<BackfireInput> => ({ throttle: t % 1 < 0.6 ? 1 : 0, revs: 0.9, burnout: t > 3 ? 1 : 0 })
    expect(run(a, 5, drive)).toEqual(run(b, 5, drive))
    run(a, 1, () => ({}), 5)
    expect(a.flash).toBe(0)
  })
})

describe('nitro ignition surge', () => {
  it('lights with a one-tick ignition, a kick that fades within half a second, and an unchanged steady boost', () => {
    const n = new Nitro(DEFAULT_VEHICLE_CONFIG.nitro)
    n.charge = 1
    const input = { slip: 0, speed: 30, grounded: true, airborne: false, wantsBoost: true }
    n.update(input, DT)
    expect(n.ignited).toBe(true)
    expect(n.surgeForce).toBeGreaterThan(0)
    n.update(input, DT)
    expect(n.ignited).toBe(false)
    for (let t = 0; t < 0.5; t += DT) n.update(input, DT)
    expect(n.surgeForce).toBe(0)
    expect(n.force).toBe(DEFAULT_VEHICLE_CONFIG.nitro.force)
  })
})

describe('backfire sound bank', () => {
  const index = JSON.parse(readFileSync('public/audio/backfire/backfire-bank.json', 'utf8')) as BackfireBankIndex
  const wav = readFileSync('public/audio/backfire/backfire-bank.wav')
  it('ships crackles and bangs that start on their pop', () => {
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    const samples = (wav.length - 44) / 2
    for (const kind of ['crackle', 'bang'] as const) {
      const list = index.kinds[kind]!
      expect(list.length).toBeGreaterThanOrEqual(3)
      for (const v of list) {
        expect(v.start + v.length).toBeLessThanOrEqual(samples)
        let peak = 0
        for (let i = 0; i < index.rate * 0.005; i++) peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + (v.start + i) * 2)))
        expect(peak / 32768, `${kind} ${v.source}`).toBeGreaterThan(0.2)
      }
    }
  })
})

describe('backfire loudness', () => {
  it('bangs are loud (the "POOO" should punch), crackles a step below, and harder pops louder', () => {
    expect(BackfireSound.level(BANG, 1)).toBeGreaterThanOrEqual(2)
    expect(BackfireSound.level(CRACKLE, 1)).toBeGreaterThanOrEqual(1)
    expect(BackfireSound.level(BANG, 1)).toBeGreaterThan(BackfireSound.level(CRACKLE, 1) * 1.5)
    expect(BackfireSound.level(BANG, 0.5)).toBeLessThan(BackfireSound.level(BANG, 1))
  })
})

describe('per-car exhaust (VehicleConfig.backfire)', () => {
  /** Pops over `lifts` lifts at high revs: on the throttle, then snapped shut. */
  const pops = (overrun: number, upshift: number, lifts = 200) => {
    const b = new Backfire({ overrun, upshift })
    let n = 0
    for (let k = 0; k < lifts; k++) {
      for (let i = 0; i < 30; i++) { b.update(1 / 60, { throttle: 1, revs: 0.9, gear: 3, burnout: 0, nitroLit: false }); if (b.popped) n++ }
      for (let i = 0; i < 60; i++) { b.update(1 / 60, { throttle: 0, revs: 0.9, gear: 3, burnout: 0, nitroLit: false }); if (b.popped) n++ }
    }
    return n
  }

  it('a quiet road exhaust pops far less than the default, a race exhaust more', () => {
    const road = pops(0.4, 0.3), stock = pops(1, 1), race = pops(1.4, 1.1)
    expect(road).toBeLessThan(stock * 0.4)
    expect(race).toBeGreaterThan(stock * 1.15)
  })
})

describe('pops per car', () => {
  const lifts = (b: Backfire, n: number) => {
    let pops = 0
    for (let i = 0; i < n; i++) {
      run(b, 0.5, () => ({ throttle: 1, revs: 0.9 }))
      pops += run(b, 1, () => ({ throttle: 0, revs: 0.85 })).length
    }
    return pops
  }

  it("a car that doesn't pop stays quiet on lifts, upshifts and burnouts, but nitro still bangs", () => {
    const b = new Backfire({ overrun: 0, upshift: 0 })
    expect(lifts(b, 10)).toBe(0)
    run(b, 0.5, () => ({ throttle: 1, revs: 0.95, gear: 2 }))
    expect(run(b, DT, () => ({ throttle: 1, revs: 0.95, gear: 3 }))).toEqual([])
    expect(run(b, 3, () => ({ throttle: 1, burnout: 1 }))).toEqual([])
    expect(run(b, DT, () => ({ nitroLit: true }))).toEqual([[0, BANG]])
  })

  it('a quick pace rattles a burst out faster than a lazy one', () => {
    const span = (pace: number) => {
      const b = new Backfire({ overrun: 1.6, upshift: 1, pace })
      run(b, 1, () => ({ throttle: 1, revs: 0.9 }))
      const pops = run(b, 3, () => ({ throttle: 0, revs: 0.85 }), 1).filter(([, k]) => k === CRACKLE)
      return (pops.at(-1)![0] - pops[0][0]) / (pops.length - 1)
    }
    expect(span(0.5)).toBeLessThan(span(1.6))
  })

  it('every car has its own pops, and the quiet road cars have none from the factory', async () => {
    const { CARS } = await import('../src/vehicles/carRegistry')
    const keys = CARS.map((c) => JSON.stringify(c.voice.pops))
    expect(new Set(keys).size).toBe(keys.length)
    for (const id of ['porsche911', 'gt3rs', 'demon', 'rs6gt']) {
      const cfg = JSON.parse(readFileSync(`public/models/cars/${id}/vehicle-config.json`, 'utf8')) as { backfire: { overrun: number; upshift: number } }
      expect(cfg.backfire.overrun, id).toBe(0)
      expect(cfg.backfire.upshift, id).toBe(0)
    }
  })
})
