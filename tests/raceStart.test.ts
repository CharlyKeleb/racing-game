import { describe, expect, it } from 'vitest'
import { StagingRevs } from '../src/audio/StagingRevs'
import { COUNTDOWN_SEC, START_LIGHTS, startLightsLit } from '../src/racing/RaceManager'

describe('start lights', () => {
  it('light one by one through the countdown and are all on before the start', () => {
    let last = 0
    for (let remaining = COUNTDOWN_SEC; remaining > 0; remaining -= 1 / 60) {
      const lit = startLightsLit(remaining)
      expect(lit - last).toBeGreaterThanOrEqual(0)
      expect(lit - last).toBeLessThanOrEqual(1)
      last = lit
    }
    expect(startLightsLit(COUNTDOWN_SEC)).toBe(0)
    expect(startLightsLit(0.3)).toBe(START_LIGHTS)
    expect(startLightsLit(0)).toBe(0)
  })
})

describe('staging revs', () => {
  it('follows the pedal and settles back to idle', () => {
    const revs = new StagingRevs(1)
    revs.reset(900)
    for (let i = 0; i < 60; i++) revs.update(1 / 60, 900, 8000, 0, 1)
    expect(revs.rpm).toBeGreaterThan(7000)
    expect(revs.throttle).toBe(1)
    for (let i = 0; i < 180; i++) revs.update(1 / 60, 900, 8000, 0, 0)
    expect(revs.rpm).toBeLessThan(950)
    expect(revs.throttle).toBe(0)
  })

  it('blips on its own and holds the requested rev floor', () => {
    const revs = new StagingRevs(2)
    revs.reset(900)
    let peak = 0
    for (let i = 0; i < 60 * 4; i++) { revs.update(1 / 60, 900, 8000, 0); peak = Math.max(peak, revs.rpm) }
    expect(peak).toBeGreaterThan(2500)
    for (let i = 0; i < 120; i++) revs.update(1 / 60, 900, 8000, 0.4)
    expect(revs.rpm).toBeGreaterThan(900 + 7100 * 0.4 - 100)
  })
})
