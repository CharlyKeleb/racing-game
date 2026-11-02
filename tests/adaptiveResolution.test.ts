import { describe, it, expect } from 'vitest'
import { AdaptiveResolution } from '../src/engine/AdaptiveResolution'
import { readRenderDiagnostics } from '../src/engine/renderDiagnostics'

function seconds(controller: AdaptiveResolution, count: number, fps: number) {
  let changes = 0
  for (let i = 0; i < count * fps; i++) if (controller.update(1 / fps)) changes++
  return changes
}

describe('adaptive resolution', () => {
  it('starts conservatively and respects the display and selected quality ceilings', () => {
    expect(new AdaptiveResolution('high', 2).ratio).toBe(1)
    expect(new AdaptiveResolution('medium', 3).max).toBe(1.5)
    const lowDpr = new AdaptiveResolution('high', .5)
    seconds(lowDpr, 30, 30)
    expect(lowDpr.ratio).toBe(.5)
    expect(new AdaptiveResolution('low', 3).ratio).toBe(.8)
  })
  it('renders the garage sharper on Medium and High, but not on Low or beyond the display', () => {
    const medium = new AdaptiveResolution('medium', 2, true)
    expect(medium.max).toBe(2)
    expect(medium.ratio).toBe(1.5)
    expect(new AdaptiveResolution('high', 3, true).max).toBe(2)
    expect(new AdaptiveResolution('medium', 1, true).ratio).toBe(1)
    expect(new AdaptiveResolution('low', 2, true).max).toBe(1)
    // Still drops when the frame rate can't hold.
    seconds(medium, 4, 30)
    expect(medium.ratio).toBeCloseTo(1.35)
  })
  it('does not resize on a single poor window or a stall', () => {
    const controller = new AdaptiveResolution('high', 2)
    expect(seconds(controller, 1, 30)).toBe(0)
    expect(controller.update(.25)).toBe(false)
    expect(controller.update(-.1)).toBe(false)
    expect(controller.update(NaN)).toBe(false)
    expect(controller.ratio).toBe(1)
  })
  it('bounds downward changes and requires sustained headroom to recover', () => {
    const controller = new AdaptiveResolution('high', 2)
    expect(seconds(controller, 2, 30)).toBe(0)
    expect(seconds(controller, 2, 30)).toBe(1)
    expect(controller.ratio).toBe(.85)
    expect(seconds(controller, 2, 60)).toBe(0)
    seconds(controller, 8, 60)
    expect(controller.ratio).toBeCloseTo(.95)
  })
  it('does not accumulate recovery through neutral or hidden windows', () => {
    const controller = new AdaptiveResolution('high', 2)
    seconds(controller, 5, 60)
    controller.resetWindow()
    seconds(controller, 5, 60)
    expect(controller.ratio).toBe(1)
    seconds(controller, 2, 56)
    seconds(controller, 5, 60)
    expect(controller.ratio).toBe(1)
  })
  it('cannot exceed preset bounds during long fast/slow runs', () => {
    const controller = new AdaptiveResolution('medium', 2)
    seconds(controller, 180, 60)
    expect(controller.ratio).toBe(1.5)
    seconds(controller, 180, 30)
    expect(controller.ratio).toBe(.75)
  })
})

it('requires capture opt-in for render cost isolation and validates fixed DPR', () => {
  expect(readRenderDiagnostics('?perfDpr=2&perfShadows=0').fixedDpr).toBeNull()
  expect(readRenderDiagnostics('?perfShadows=0').shadowsOff).toBe(false)
  expect(readRenderDiagnostics('?perf=1&perfDpr=1&perfShadows=0&perfPostfx=0')).toEqual({ fixedDpr: 1, shadowsOff: true, postfxOff: true, postfxQuality: null })
  expect(readRenderDiagnostics('?perf=1&perfDpr=999').fixedDpr).toBeNull()
})
