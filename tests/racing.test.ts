import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { FIXED_DT, GameLoop } from '../src/engine/GameLoop'
import { CheckpointManager } from '../src/racing/CheckpointManager'
import { formatTime, LapTimer } from '../src/racing/LapTimer'
import type { Checkpoint } from '../src/world/Track'

describe('LapTimer', () => {
  it('tracks laps and best', () => {
    const t = new LapTimer()
    t.running = true
    t.tick(61.5)
    expect(t.completeLap()).toBe(true)
    t.tick(59)
    expect(t.completeLap()).toBe(true)
    t.tick(70)
    expect(t.completeLap()).toBe(false)
    expect(t.bestLapMs).toBe(59000)
    expect(t.totalMs).toBe(190500)
  })

  it('formats times', () => {
    expect(formatTime(61234)).toBe('1:01.234')
    expect(formatTime(null)).toBe('--:--.---')
  })
})

describe('CheckpointManager', () => {
  // Square loop, travelling +X along z=0 then around.
  const cps: Checkpoint[] = [
    [0, 0, 1, 0],
    [100, 0, 0, 1],
    [100, 100, -1, 0],
    [0, 100, 0, -1],
  ].map(([x, z, tx, tz], index) => ({
    index,
    position: new THREE.Vector3(x, 0, z),
    tangent: new THREE.Vector3(tx, 0, tz),
    radius: 10,
  }))

  const drive = (m: CheckpointManager, from: [number, number], to: [number, number]) => {
    const steps = 50
    const results: string[] = []
    for (let i = 0; i <= steps; i++) {
      const p = new THREE.Vector3(from[0] + ((to[0] - from[0]) * i) / steps, 0, from[1] + ((to[1] - from[1]) * i) / steps)
      const r = m.update(p)
      if (r) results.push(r)
    }
    return results
  }

  it('counts a lap only after every checkpoint in order', () => {
    const m = new CheckpointManager(cps)
    expect(drive(m, [-5, 0], [5, 0])).toEqual([]) // start line before cp1 — not a lap
    expect(drive(m, [100, -5], [100, 5])).toEqual(['checkpoint'])
    expect(drive(m, [105, 100], [95, 100])).toEqual(['checkpoint'])
    expect(drive(m, [0, 105], [0, 95])).toEqual(['checkpoint'])
    expect(drive(m, [-5, 0], [5, 0])).toEqual(['lap'])
  })

  it('counts a gate driven through wide of its radius, as on a run-off', () => {
    const m = new CheckpointManager(cps)
    expect(drive(m, [115, -5], [115, 5])).toEqual(['checkpoint'])
  })

  it('still ignores a gate passed far away or backwards', () => {
    const m = new CheckpointManager(cps)
    expect(drive(m, [140, -5], [140, 5])).toEqual([])
    expect(drive(m, [100, 5], [100, -5])).toEqual([])
    expect(m.next).toBe(1)
  })
})

describe('GameLoop', () => {
  it('runs fixed steps independent of frame time and caps catch-up', () => {
    const fixed = vi.fn()
    const loop = new GameLoop({ fixedUpdate: fixed, render: () => {} })
    expect(loop.advance(FIXED_DT * 3 + 0.001)).toBe(3)
    expect(fixed).toHaveBeenCalledWith(FIXED_DT)
    // A hitch admits at most 0.25 s, serviced over bounded frames.
    expect(loop.advance(5)).toBe(5)
    expect(loop.advance(0)).toBe(5)
    expect(loop.advance(0)).toBe(5)
    expect(fixed).toHaveBeenCalledTimes(18)
  })
})
