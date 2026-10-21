import { describe, expect, it } from 'vitest'
import { BrakeHeat, brakeGlow } from '../src/vehicles/BrakeHeat'

const DT = 1 / 60

/** Brake from `from` m/s to a stop at `decel` m/s², then return the heat. */
function stop(heat: BrakeHeat, from: number, decel = 12): void {
  for (let v = from; v > 0; v -= decel * DT) heat.update(DT, 1, v)
}
function cruise(heat: BrakeHeat, speed: number, seconds: number): void {
  for (let t = 0; t < seconds; t += DT) heat.update(DT, 0, speed)
}

describe('brake disc heat (#92)', () => {
  it('a brief tap does not make cold discs glow', () => {
    const heat = new BrakeHeat()
    for (let t = 0; t < 0.3; t += DT) heat.update(DT, 1, 28)
    expect(brakeGlow(heat.front)).toBe(0)
  })

  it('repeated high-speed stops build visible heat, fronts hotter than rears', () => {
    const heat = new BrakeHeat()
    stop(heat, 55)
    const once = brakeGlow(heat.front)
    cruise(heat, 40, 4)
    stop(heat, 55)
    cruise(heat, 40, 4)
    stop(heat, 55)
    expect(brakeGlow(heat.front)).toBeGreaterThan(once)
    expect(brakeGlow(heat.front)).toBeGreaterThan(0.5)
    expect(heat.front).toBeGreaterThan(heat.rear)
  })

  it('cruising cools them, faster than sitting still', () => {
    const fast = new BrakeHeat(), still = new BrakeHeat()
    fast.front = still.front = 0.9
    cruise(fast, 40, 10)
    cruise(still, 0, 10)
    expect(brakeGlow(fast.front)).toBeLessThan(0.01)
    expect(still.front).toBeGreaterThan(fast.front)
  })

  it('stays in range, freezes on dt 0 (pause) and resets', () => {
    const heat = new BrakeHeat()
    for (let i = 0; i < 20; i++) stop(heat, 80)
    expect(heat.front).toBeLessThanOrEqual(1)
    const before = heat.front
    heat.update(0, 1, 80)
    expect(heat.front).toBe(before)
    heat.reset()
    expect(heat.front + heat.rear).toBe(0)
  })
})
