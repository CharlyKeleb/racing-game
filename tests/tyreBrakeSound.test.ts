import { describe, expect, it } from 'vitest'
import { tyreBrakeLevels, type TyreBrakeInput } from '../src/audio/TyreBrakeModel'
import { getCar } from '../src/vehicles/carRegistry'

const cruise: TyreBrakeInput = { speed: 30, brake: 0, slip: 0.4, slide: 0, paved: 1, drifting: false, kerb: 0 }
const porsche = getCar('porsche911').noise
const koenigsegg = getCar('koenigsegg').noise
const bmw = getCar('bmw').noise

describe('tyre and brake sound model', () => {
  it('is silent cruising and on grass', () => {
    const l = tyreBrakeLevels(cruise, porsche)
    expect(l.squeal + l.scrub + l.brakeHiss + l.grind + l.brakeSqueal + l.abs).toBe(0)
    const grass = tyreBrakeLevels({ ...cruise, slip: 1, slide: 8, drifting: true, paved: 0 }, porsche)
    expect(grass.squeal).toBe(0)
  })

  it('squeals in a drift, louder the harder it slides', () => {
    const light = tyreBrakeLevels({ ...cruise, slip: 1, slide: 2 }, porsche)
    const full = tyreBrakeLevels({ ...cruise, slip: 1, slide: 8, drifting: true }, porsche)
    expect(light.squeal).toBeGreaterThan(0)
    expect(full.squeal).toBeGreaterThan(light.squeal)
    expect(full.squealPitch).toBeGreaterThan(1)
  })

  it('road tyres sing, cup tyres less, slicks mostly scrub', () => {
    const drift = { ...cruise, slip: 1, slide: 8, drifting: true }
    const road = tyreBrakeLevels(drift, porsche), cup = tyreBrakeLevels(drift, koenigsegg), slick = tyreBrakeLevels(drift, bmw)
    expect(road.squeal).toBeGreaterThan(cup.squeal)
    expect(cup.squeal).toBeGreaterThan(slick.squeal)
    expect(slick.scrub).toBeGreaterThan(road.scrub)
    expect(porsche.tyres.squealHz).toBeGreaterThan(koenigsegg.tyres.squealHz)
    expect(koenigsegg.tyres.squealHz).toBeGreaterThan(bmw.tyres.squealHz)
  })

  it('ABS cars chatter at the limit; the race car without ABS locks up and howls', () => {
    const limit = { ...cruise, brake: 1, slip: 1 }
    const abs = tyreBrakeLevels(limit, porsche)
    expect(abs.abs).toBeGreaterThan(0.5)
    const locked = tyreBrakeLevels(limit, bmw)
    expect(locked.abs).toBe(0)
    expect(locked.squealPitch).toBeGreaterThan(abs.squealPitch)
    expect(locked.scrub).toBeGreaterThan(0.5)
  })

  it('race pads grind; road brakes only hiss at speed', () => {
    const braking = { ...cruise, brake: 0.6 }
    expect(tyreBrakeLevels(braking, bmw).grind).toBeGreaterThan(0.3)
    expect(tyreBrakeLevels(braking, porsche).grind).toBe(0)
    expect(tyreBrakeLevels(braking, porsche).brakeHiss).toBeGreaterThan(0)
  })

  it('brakes squeal at walking pace, except race pads', () => {
    const creeping = { ...cruise, speed: 2.2, brake: 0.4, slip: 0.2 }
    expect(tyreBrakeLevels(creeping, porsche).brakeSqueal).toBeGreaterThan(0.5)
    expect(tyreBrakeLevels(creeping, koenigsegg).brakeSqueal).toBeGreaterThan(0.5)
    expect(tyreBrakeLevels(creeping, bmw).brakeSqueal).toBe(0)
    expect(tyreBrakeLevels({ ...creeping, speed: 20 }, porsche).brakeSqueal).toBe(0)
  })

  it('every selectable car has its own profile', () => {
    const profiles = new Set(['porsche911', 'koenigsegg', 'bmw'].map((id) => JSON.stringify(getCar(id).noise)))
    expect(profiles.size).toBe(3)
  })
})
