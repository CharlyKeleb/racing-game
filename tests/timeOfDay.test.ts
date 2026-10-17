import { describe, expect, it } from 'vitest'
import { isTimeOfDay, TIME_OF_DAY_ORDER, TIME_PRESETS } from '../src/world/timeOfDay'

describe('time-of-day presets', () => {
  it('has every preset the issue asks for, in picker order', () => {
    expect(TIME_OF_DAY_ORDER).toEqual(['noon', 'golden', 'overcast', 'night'])
    for (const id of TIME_OF_DAY_ORDER) expect(TIME_PRESETS[id]).toBeDefined()
  })

  it('keeps the sky radiance clamp near the bloom threshold so the sun never floods the screen', () => {
    for (const p of Object.values(TIME_PRESETS)) {
      expect(p.skyMax).toBeGreaterThan(0)
      expect(p.skyMax).toBeLessThanOrEqual(1.6)
    }
  })

  it('turns headlights on only at night, where the sun is below the horizon', () => {
    for (const [id, p] of Object.entries(TIME_PRESETS)) {
      expect(p.headlights).toBe(id === 'night')
      if (id === 'night') expect(p.skySun.elevation).toBeLessThan(0)
      else expect(p.skySun.elevation).toBeGreaterThan(0)
    }
  })

  it('starts fog inside the view distance and keeps lights non-negative', () => {
    for (const p of Object.values(TIME_PRESETS)) {
      expect(p.fogStart).toBeGreaterThan(0)
      expect(p.fogStart).toBeLessThan(1)
      expect(p.key.intensity).toBeGreaterThanOrEqual(0)
      expect(p.fill.intensity).toBeGreaterThanOrEqual(0)
      expect(p.envIntensity).toBeGreaterThan(0)
    }
  })

  it('validates stored values', () => {
    expect(isTimeOfDay('night')).toBe(true)
    expect(isTimeOfDay('midnight')).toBe(false)
    expect(isTimeOfDay(undefined)).toBe(false)
  })
})
