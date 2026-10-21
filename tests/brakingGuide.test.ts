import { describe, expect, it } from 'vitest'
import { AiDriver } from '../src/racing/AiDriver'
import { BRAKE, BrakingGuide, CORNER_SPEED, GO, LIFT } from '../src/racing/BrakingGuide'

/** A 600 m straight, a tight 25 m-radius hairpin, and back: a stadium oval sampled every ~4 m. */
function stadium(): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = []
  const R = 25, L = 600
  for (let z = 0; z < L; z += 4) pts.push({ x: R, y: 0, z })
  for (let a = 0; a < Math.PI; a += 4 / R) pts.push({ x: R * Math.cos(a), y: 0, z: L + R * Math.sin(a) })
  for (let z = L; z > 0; z -= 4) pts.push({ x: -R, y: 0, z })
  for (let a = Math.PI; a < 2 * Math.PI; a += 4 / R) pts.push({ x: R * Math.cos(a), y: 0, z: R * Math.sin(a) })
  return pts
}
const car = { grip: 1.25, downforcePerKg: 1.6 / 1420, brakeDecel: 22000 / 1420 }
const line = stadium()
const hairpin = line.findIndex((p) => p.z > 600)

describe('braking guide (#93)', () => {
  const guide = new BrakingGuide(line, car)

  it('plans slow through the hairpin, fast on the straight, and is more cautious than the AI', () => {
    expect(guide.speeds[hairpin + 5]).toBeLessThan(20)
    expect(guide.speeds[40]).toBeGreaterThan(40)
    const ai = new AiDriver(line, { ...car, wheelbase: 2.6, maxSteerAngle: 0.55, steerFalloffSpeed: 9, peakSlip: 0.1, arcade: { enabled: false } as never, steerPeakSlipScale: 0 } as never)
    expect(guide.speeds[hairpin + 5]).toBeLessThan(ai.speeds[hairpin + 5])
  })

  it('cues go far from the corner, then lift, then brake as the point comes up at speed', () => {
    const speed = 60 // 216 km/h down the straight
    const point = hairpin + 2
    expect(guide.cue(point, speed, 400)).toBe(GO)
    expect(guide.cue(point, speed, 270)).toBe(LIFT)
    expect(guide.cue(point, speed, 200)).toBe(BRAKE)
    // Already slow enough: always go.
    expect(guide.cue(point, 10, 5)).toBe(GO)
  })

  it('a stronger car (more grip and brakes, as an upgraded build) plans later braking and faster corners', () => {
    const tuned = new BrakingGuide(line, { grip: 1.45, downforcePerKg: car.downforcePerKg, brakeDecel: 26000 / 1420 })
    expect(tuned.speeds[hairpin + 5]).toBeGreaterThan(guide.speeds[hairpin + 5])
    expect(tuned.braking).toBeGreaterThan(guide.braking)
  })

  it('is more cautious in the wet', () => {
    const wet = new BrakingGuide(line, car, true)
    expect(wet.speeds[hairpin + 5]).toBeLessThan(guide.speeds[hairpin + 5])
  })

  it('"corners only" covers the hairpin and its braking zone, not the middle of the straight', () => {
    expect(guide.isCorner(hairpin + 5)).toBe(true)
    expect(guide.isCorner(hairpin - 5)).toBe(true)
    expect(guide.isCorner(60)).toBe(false)
    expect(guide.speeds[60]).toBeGreaterThanOrEqual(CORNER_SPEED)
  })

  it('measures distance ahead around the closed loop', () => {
    expect(guide.ahead(10, 12)).toBeCloseTo(8, 0)
    expect(guide.ahead(line.length - 1, 1)).toBeGreaterThan(0)
    expect(guide.ahead(line.length - 1, 1)).toBeLessThan(20)
  })
})
