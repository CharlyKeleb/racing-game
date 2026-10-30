import { describe, expect, it } from 'vitest'
import { RaceStandings, type RaceEntry } from '../src/racing/RaceStandings'
import { RecoveryMonitor } from '../src/racing/RecoveryMonitor'
import { planSafetyWalls } from '../src/world/SafetyWalls'

const fine = { drop: 0, upY: 1, speed: 30, pedal: 1, offLine: 3 }
const run = (m: RecoveryMonitor, seconds: number, s: typeof fine) => {
  let reason = null
  for (let t = 0; t < seconds * 60 && !reason; t++) reason = m.update(1 / 60, s)
  return reason
}

describe('recovery monitor', () => {
  it('leaves a car that is driving alone', () => {
    expect(run(new RecoveryMonitor(), 30, fine)).toBeNull()
  })
  it('recovers a car that dropped off the world at once', () => {
    expect(new RecoveryMonitor().update(1 / 60, { ...fine, drop: -9 })).toBe('fell')
  })
  it('recovers a car on its roof, but rides out a brief tip', () => {
    expect(run(new RecoveryMonitor(), 1, { ...fine, upY: -0.5 })).toBeNull()
    expect(run(new RecoveryMonitor(), 3, { ...fine, upY: -0.5 })).toBe('flipped')
  })
  it('recovers a wedged car only while its driver is trying to move', () => {
    expect(run(new RecoveryMonitor(), 10, { ...fine, speed: 0, pedal: 0 })).toBeNull()
    expect(run(new RecoveryMonitor(), 5, { ...fine, speed: 0.3, pedal: 1 })).toBe('stuck')
  })
  it('recovers a car lost far from the track', () => {
    expect(run(new RecoveryMonitor(), 5, { ...fine, offLine: 90 })).toBe('lost')
  })
})

/** A hairpin: up the +Z straight, round, and back down a straight 20 m away. */
function hairpin(): { x: number; y: number; z: number }[] {
  const pts = []
  for (let z = 0; z <= 300; z += 5) pts.push({ x: 0, y: 0, z })
  for (let a = 1; a < 12; a++) pts.push({ x: 10 - 10 * Math.cos((a * Math.PI) / 12), y: 0, z: 300 + 10 * Math.sin((a * Math.PI) / 12) })
  for (let z = 300; z >= 0; z -= 5) pts.push({ x: 20, y: 0, z })
  for (let a = 1; a < 12; a++) pts.push({ x: 10 + 10 * Math.cos((a * Math.PI) / 12), y: 0, z: -10 * Math.sin((a * Math.PI) / 12) })
  return pts
}

describe('standings where the track folds back', () => {
  const line = hairpin()
  // One long sector holds both straights, as on a real circuit with few gates.
  const standings = new RaceStandings(line, [{ position: line[0] }, { position: line[125] }])
  const entry = (x: number, z: number, index: number): RaceEntry => ({ id: 1, name: 'A', player: false, lap: 1, checkpoint: 0, index, finishMs: null, x, z })

  it('keeps a car run wide on the return straight on its own stretch', () => {
    // 150 m back down the return straight, slid 12 m wide toward the outbound one.
    const outbound = 150
    const back = 300 + Math.PI * 10 + 150
    const wide = standings.distance(entry(8, 150, 102))
    expect(Math.abs(wide - back)).toBeLessThan(3)
    expect(Math.abs(wide - outbound)).toBeGreaterThan(100)
  })

  it('puts a recovering car just behind itself, never past its next gate', () => {
    const at = entry(20, 150, 102)
    expect(standings.recoveryIndex(at)).toBe(100)
    expect(standings.recoveryIndex({ ...at, index: 130 })).toBeLessThan(125)
  })
})

describe('safety walls', () => {
  // A 100 m-radius ring circuit, 4 m between points.
  const n = Math.round((2 * Math.PI * 100) / 4)
  const line = Array.from({ length: n }, (_, i) => ({ x: 100 * Math.cos((i / n) * 2 * Math.PI), y: 0, z: 100 * Math.sin((i / n) * 2 * Math.PI) }))
  const radiusOf = (walls: { vertices: Float32Array }) => {
    const r: number[] = []
    for (let i = 0; i < walls.vertices.length; i += 3) r.push(Math.hypot(walls.vertices[i], walls.vertices[i + 2]))
    return r
  }
  it('stand where the floor ends and nowhere it carries on', () => {
    // Floor ends 9 m outside the line; inside it carries on across the infield.
    const walls = planSafetyWalls(line, { floor: (x, _y, z) => (Math.hypot(x, z) <= 109 ? 0 : null) })
    expect(walls.segments).toBe(n)
    for (const r of radiusOf(walls)) {
      expect(r).toBeGreaterThanOrEqual(108)
      expect(r).toBeLessThan(111)
    }
  })
  it('step over a one-probe seam in the floor', () => {
    const walls = planSafetyWalls(line, { floor: (x, _y, z) => (Math.abs(Math.hypot(x, z) - 110) < 1 || Math.hypot(x, z) > 150 ? null : 0) })
    expect(walls.segments).toBe(n)
    for (const r of radiusOf(walls)) expect(r).toBeGreaterThan(145)
  })
})

describe('safety walls before the floor is there', () => {
  it('builds nothing when even the road under the line is missing', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: 100 * Math.cos(i / 8), y: 0, z: 100 * Math.sin(i / 8) }))
    expect(planSafetyWalls(line, { floor: () => null }).segments).toBe(0)
  })
})

describe('safety walls at a drop', () => {
  it('treat a sudden drop to lower ground as the edge', () => {
    const n = Math.round((2 * Math.PI * 100) / 4)
    const line = Array.from({ length: n }, (_, i) => ({ x: 100 * Math.cos((i / n) * 2 * Math.PI), y: 0, z: 100 * Math.sin((i / n) * 2 * Math.PI) }))
    // Quay edge 9 m outside the line, then the harbour floor 8 m down.
    const walls = planSafetyWalls(line, { floor: (x, _y, z) => (Math.hypot(x, z) <= 109 ? 0 : -8) })
    expect(walls.segments).toBe(n)
    for (let i = 0; i < walls.vertices.length; i += 3) expect(Math.hypot(walls.vertices[i], walls.vertices[i + 2])).toBeLessThan(111)
  })
})
