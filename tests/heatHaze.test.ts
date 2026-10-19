import { describe, expect, it } from 'vitest'
import { hazeIntensity } from '../src/effects/HeatHaze'

describe('exhaust heat haze', () => {
  it('is strong idling on the grid and faint once cruising', () => {
    const idle = hazeIntensity(0, 0, 0)
    const cruising = hazeIntensity(30, 0.3, 0)
    expect(idle).toBeGreaterThan(0.75)
    expect(cruising).toBeLessThan(0.3)
    expect(cruising).toBeGreaterThan(0)
  })

  it('builds with revs on the start line', () => {
    expect(hazeIntensity(0, 1, 0)).toBeGreaterThan(hazeIntensity(0, 0, 0))
  })

  it('is strongest on nitro, at any speed', () => {
    const boost = hazeIntensity(50, 1, 1)
    expect(boost).toBeGreaterThan(hazeIntensity(0, 1, 0))
    expect(boost).toBeGreaterThan(1)
    expect(hazeIntensity(0, 1, 2)).toBeLessThanOrEqual(1.6)
  })
})
