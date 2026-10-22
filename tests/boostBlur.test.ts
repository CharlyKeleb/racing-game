import { describe, expect, it } from 'vitest'
import { boostBlurSamples, boostBlurTarget, stepBoostBlur } from '../src/effects/BoostBlur'

describe('nitro boost blur', () => {
  it('only blurs a live boost at speed, scaled by the Motion blur setting', () => {
    expect(boostBlurTarget(0, 200, .65)).toBe(0)
    expect(boostBlurTarget(1, 40, .65)).toBe(0)
    expect(boostBlurTarget(1, 200, 0)).toBe(0)
    expect(boostBlurTarget(1, 200, .65)).toBe(1)
    expect(boostBlurTarget(1, 200, .25)).toBeCloseTo(.5)
    expect(boostBlurTarget(1.6, 200, 1)).toBe(1.25)
    expect(boostBlurTarget(1, 95, 1)).toBeGreaterThan(0)
    expect(boostBlurTarget(1, 95, 1)).toBeLessThan(1)
    expect(boostBlurTarget(1, Number.NaN, 1)).toBe(0)
  })
  it('snaps in on ignition and eases out, settling at zero', () => {
    let s = 0
    for (let i = 0; i < 12; i++) s = stepBoostBlur(s, 1, 1 / 60)
    expect(s).toBeGreaterThan(.8)
    let frames = 0
    while (s > 0 && frames < 600) { s = stepBoostBlur(s, 0, 1 / 60); frames++ }
    expect(s).toBe(0)
    expect(frames).toBeGreaterThan(60)
    expect(stepBoostBlur(.5, 1, 0)).toBe(.5)
  })
  it('scales samples with the preset', () => {
    expect(boostBlurSamples('low')).toBeLessThan(boostBlurSamples('medium'))
    expect(boostBlurSamples('medium')).toBeLessThan(boostBlurSamples('high'))
  })
})
