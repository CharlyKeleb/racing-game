import { describe, expect, it } from 'vitest'
import { performanceCapture, summarize } from '../src/engine/PerformanceCapture'
import { GameLoop } from '../src/engine/GameLoop'

describe('opt-in performance capture', () => {
  it('stays disabled in normal and headless runs', () => {
    expect(performanceCapture.active).toBe(false)
  })
  it('uses nearest-rank percentiles and strict stall thresholds', () => {
    expect(summarize([])).toEqual({ count: 0, p50: null, p95: null, p99: null, over33: 0, over50: 0, over100: 0 })
    expect(summarize([101, 16, 50, 33, 100])).toEqual({ count: 5, p50: 50, p95: 101, p99: 101, over33: 3, over50: 2, over100: 1 })
  })
  it('does not change fixed-step catch-up after a long stall', () => {
    let ticks = 0
    const loop = new GameLoop({ fixedUpdate: () => ticks++, render: () => {} })
    expect(loop.advance(.5)).toBe(15)
    expect(ticks).toBe(15)
  })
})
