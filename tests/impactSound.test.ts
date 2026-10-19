import { describe, expect, it } from 'vitest'
import { curbStrength, impactLayers, impactStrength, scrapeLevel } from '../src/audio/ImpactModel'
import { tyreBrakeLevels } from '../src/audio/TyreBrakeModel'
import { getCar } from '../src/vehicles/carRegistry'

describe('impact sound model', () => {
  it('ignores brushes and grows with the hit, topping out on a big one', () => {
    expect(impactStrength(0.3)).toBe(0)
    const tap = impactStrength(1.5), shunt = impactStrength(5), big = impactStrength(12), huge = impactStrength(40)
    expect(tap).toBeGreaterThan(0)
    expect(shunt).toBeGreaterThan(tap)
    expect(big).toBeCloseTo(1)
    expect(huge).toBe(1)
  })

  it('gives car-on-car hits ringing panels, walls a heavier thud, and only big hits debris', () => {
    const car = impactLayers('car', 0.5), wall = impactLayers('wall', 0.5)
    expect(car.ring).toBeGreaterThan(wall.ring)
    expect(wall.thudHz).toBeLessThan(car.thudHz)
    expect(car.debris).toBe(0)
    expect(impactLayers('car', 1).debris).toBeGreaterThan(0.9)
    expect(impactLayers('car', 1).crunchDecay).toBeGreaterThan(car.crunchDecay)
  })

  it('thunks on a curb strike at speed, not crawling over one or on a smooth road', () => {
    expect(curbStrength(0.5, 30)).toBe(0) // normal suspension movement
    expect(curbStrength(3, 1)).toBe(0) // crawling
    expect(curbStrength(3, 25)).toBeGreaterThan(0.4)
  })

  it('scrapes only while sliding along the wall', () => {
    expect(scrapeLevel(false, 30)).toBe(0)
    expect(scrapeLevel(true, 0.5)).toBe(0)
    expect(scrapeLevel(true, 20)).toBeGreaterThan(0.9)
  })

  it('rumbles over kerbs at a rate set by speed', () => {
    const base = { speed: 30, brake: 0, slip: 0.3, slide: 0, paved: 1, drifting: false, kerb: 0 }
    const porsche = getCar('porsche911').noise
    expect(tyreBrakeLevels(base, porsche).kerbRumble).toBe(0)
    const onKerb = tyreBrakeLevels({ ...base, kerb: 0.5 }, porsche)
    expect(onKerb.kerbRumble).toBeGreaterThan(0.4)
    expect(onKerb.kerbRate).toBeCloseTo(30 / 0.35)
    expect(tyreBrakeLevels({ ...base, kerb: 0.5, speed: 15 }, porsche).kerbRate).toBeLessThan(onKerb.kerbRate)
  })
})
