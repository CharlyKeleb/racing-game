import { describe, expect, it } from 'vitest'
import { sparkCount } from '../src/effects/Sparks'

const DT = 1 / 60

describe('spark emission', () => {
  it('throws nothing from a light brush at low speed', () => {
    expect(sparkCount(0.1, 2, DT)).toBe(0)
  })

  it('streams more sparks the faster the car slides along a wall', () => {
    const slow = sparkCount(0, 8, DT), fast = sparkCount(0, 40, DT)
    expect(slow).toBeGreaterThan(0)
    expect(fast).toBeGreaterThan(slow * 5)
    // A full second at 40 m/s: about a thousand streaks.
    expect(sparkCount(0, 40, 1)).toBeGreaterThan(900)
  })

  it('bursts on a hard hit, scaled by the change in speed and capped', () => {
    const tap = sparkCount(1, 0, DT), crash = sparkCount(5, 0, DT)
    expect(tap).toBeGreaterThan(10)
    expect(crash).toBeGreaterThan(tap * 4)
    expect(sparkCount(100, 0, DT)).toBeLessThanOrEqual(220)
  })

  it('carries fractions so a slow scrape still spits the odd spark', () => {
    let carry = 0, total = 0
    for (let i = 0; i < 60; i++) {
      const n = sparkCount(0, 4, DT, carry)
      total += Math.floor(n)
      carry = n - Math.floor(n)
    }
    expect(total).toBeGreaterThanOrEqual(27)
  })
})
