import { describe, expect, it } from 'vitest'
import { TILT_DEADZONE, TILT_FULL_LOCK, tiltDegrees, tiltToSteer } from '../src/input/TiltSteering'

describe('tilt steering', () => {
  it('reads a level phone as straight in every orientation', () => {
    for (const angle of [0, 90, 180, 270]) {
      expect(tiltDegrees(0, 0, angle)).toBeCloseTo(0)
      expect(tiltDegrees(angle % 180 ? 0 : 90, 0, angle)).toBeCloseTo(0)
    }
  })

  it('landscape: turning the phone clockwise steers right, whatever angle it is tipped back', () => {
    // Landscape (screen angle 90): the phone's top edge is the screen's left end, so lifting it
    // (beta > 0) tips the right end down. Held top edge up and tipped back, gamma is negative.
    for (const tippedBack of [0, -30, -60]) {
      const right = tiltDegrees(10, tippedBack, 90)
      expect(right).toBeGreaterThan(0)
      expect(tiltDegrees(-10, tippedBack, 90)).toBeCloseTo(-right)
    }
    // Flat on a table, 10° of beta is 10° of tilt.
    expect(tiltDegrees(10, 0, 90)).toBeCloseTo(10)
    // The other landscape flips the axis.
    expect(tiltDegrees(10, 0, 270)).toBeCloseTo(-10)
  })

  it('upright, a 20° wheel turn reads 20° whether the phone is held straight up or tipped back', () => {
    // Portrait: tipped back by beta, turned like a wheel by 20° about the screen's normal.
    const turned = (back: number) => {
      const b = (back * Math.PI) / 180, t = (20 * Math.PI) / 180
      // Down in device axes, then the inverse orientation solve for beta/gamma.
      const d = [Math.sin(t) * Math.sin(b), -Math.cos(t) * Math.sin(b), -Math.cos(b)]
      const beta = Math.asin(-d[1]) * 180 / Math.PI, gamma = Math.atan2(d[0], -d[2]) * 180 / Math.PI
      return tiltDegrees(beta, gamma, 0)
    }
    expect(turned(90)).toBeCloseTo(20, 0)
    expect(turned(60)).toBeCloseTo(20, 0)
  })

  it('portrait: tipping right is gamma', () => {
    expect(tiltDegrees(0, 15, 0)).toBeCloseTo(15)
    expect(tiltDegrees(60, 15, 0)).toBeGreaterThan(0)
  })

  it('maps tilt to steering with a dead zone and full lock', () => {
    expect(tiltToSteer(TILT_DEADZONE * 0.9)).toBe(0)
    expect(tiltToSteer(TILT_DEADZONE + 0.01)).toBeGreaterThan(0)
    expect(tiltToSteer(TILT_DEADZONE + 0.01)).toBeLessThan(0.01)
    expect(tiltToSteer(TILT_FULL_LOCK)).toBe(1)
    expect(tiltToSteer(-90)).toBe(-1)
    expect(tiltToSteer(-(TILT_FULL_LOCK + TILT_DEADZONE) / 2)).toBeCloseTo(-0.5)
  })
})
