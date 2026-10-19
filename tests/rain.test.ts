import { describe, expect, it } from 'vitest'
import { sprayAmount } from '../src/effects/RainSpray'
import { RAIN_EXPOSURE, RAIN_FALL } from '../src/effects/Rain'

describe('rain', () => {
  it('throws no spray crawling, and much more at speed', () => {
    expect(sprayAmount(0)).toBe(0)
    expect(sprayAmount(4)).toBe(0)
    const slow = sprayAmount(15), fast = sprayAmount(60)
    expect(slow).toBeGreaterThan(0)
    expect(fast).toBeGreaterThan(slow * 5)
    expect(sprayAmount(40)).toBeCloseTo(1, 5)
  })

  it('draws short streaks standing still and long ones at racing speed', () => {
    const still = Math.hypot(RAIN_FALL.x, RAIN_FALL.y, RAIN_FALL.z) * RAIN_EXPOSURE
    const at250 = Math.hypot(RAIN_FALL.x, RAIN_FALL.y, RAIN_FALL.z - 250 / 3.6) * RAIN_EXPOSURE
    expect(still).toBeGreaterThan(0.08)
    expect(still).toBeLessThan(0.25)
    expect(at250).toBeGreaterThan(still * 5)
  })
})
