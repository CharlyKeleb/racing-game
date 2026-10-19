import { describe, expect, it } from 'vitest'
import { RaceStandings, type RaceEntry } from '../src/racing/RaceStandings'
import type { Point3 } from '../src/racing/TrackProgress'

/**
 * A 400 m x 200 m loop with very uneven point spacing (2 m on one straight,
 * 25 m on another, like a real exported centreline), driven anticlockwise.
 */
function unevenLoop(): Point3[] {
  const pts: Point3[] = []
  for (let z = 0; z < 400; z += 2) pts.push({ x: 0, y: 0, z })          // dense straight
  for (let x = 0; x < 200; x += 20) pts.push({ x, y: 0, z: 400 })        // medium
  for (let z = 400; z > 0; z -= 25) pts.push({ x: 200, y: 0, z })        // sparse straight
  for (let x = 200; x > 0; x -= 10) pts.push({ x, y: 0, z: 0 })
  return pts
}
const LAP = 1200
/** True distance along the loop from the start (0,0,0) to a point on it. */
function along(x: number, z: number): number {
  if (x === 0) return z
  if (z === 400) return 400 + x
  if (x === 200) return 600 + (400 - z)
  return 1000 + (200 - x)
}

const line = unevenLoop()
const gateAt = (x: number, z: number) => ({ position: { x, y: 0, z } })
const standings = new RaceStandings(line, [gateAt(0, 0), gateAt(0, 300), gateAt(150, 400), gateAt(200, 100)])
/** An entry on the loop at (x, z), with the checkpoint it would have validated. */
function car(id: number, x: number, z: number, lap = 1): RaceEntry {
  const d = along(x, z)
  const checkpoint = d >= 900 ? 3 : d >= 550 ? 2 : d >= 300 ? 1 : 0
  return { id, name: `Car ${id}`, player: id === 0, lap, checkpoint, index: 0, finishMs: null, x, z }
}

describe('race standings', () => {
  it('measures a lap as the real centreline length', () => {
    expect(standings.lapLength).toBeCloseTo(LAP, 0)
  })

  it('reports gaps in real metres even where point spacing is uneven', () => {
    const cases: [number, number][] = [[0, 50], [0, 299], [0, 310], [60, 400], [170, 400], [200, 380], [200, 120], [200, 90], [120, 0]]
    for (const [x, z] of cases) {
      expect(Math.abs(standings.distance(car(1, x, z)) - along(x, z)), `at ${x},${z}`).toBeLessThan(1)
    }
    const leader = car(1, 200, 210), chaser = car(2, 0, 350)
    const gap = standings.snapshot([chaser, leader])[1].gapMeters
    expect(gap).toBeCloseTo(along(200, 210) - along(0, 350), 0)
  })

  it('keeps distance continuous across the finish line into the next lap', () => {
    const before = standings.distance(car(1, 4, 0))
    const after = standings.distance(car(1, 0, 4, 2))
    expect(after - before).toBeGreaterThan(0)
    expect(after - before).toBeLessThan(10)
  })

  it('orders a field anywhere on the lap, including across laps', () => {
    const field = [car(1, 0, 100), car(2, 200, 300), car(3, 100, 0), car(4, 0, 20, 2)]
    expect(standings.snapshot(field).map(s => s.id)).toEqual([4, 3, 2, 1])
  })

  it('puts a car still behind the start line on the grid behind everyone', () => {
    const grid = { ...car(0, 0, 0), lap: 0, x: 0, z: -12 }
    const snap = standings.snapshot([grid, car(1, 0, 30)])
    expect(snap.map(s => s.id)).toEqual([1, 0])
    expect(snap[1].gapMeters).toBeCloseTo(42, 0)
  })

  it('counts whole laps down for a lapped car', () => {
    const snap = standings.snapshot([car(1, 0, 100, 3), car(2, 0, 50, 1)])
    expect(snap[1].gapLaps).toBe(2)
  })

  it('holds a place side by side until the other car is clearly ahead', () => {
    const s = new RaceStandings(line, [gateAt(0, 0), gateAt(0, 300), gateAt(150, 400), gateAt(200, 100)])
    expect(s.snapshot([car(1, 0, 100), car(2, 0, 99)]).map(e => e.id)).toEqual([1, 2])
    // Car 2 noses ahead by less than the margin: no swap, and no flicker back.
    expect(s.snapshot([car(1, 0, 100), car(2, 0, 100.4)]).map(e => e.id)).toEqual([1, 2])
    expect(s.snapshot([car(1, 0, 100), car(2, 0, 101.5)]).map(e => e.id)).toEqual([2, 1])
    expect(s.snapshot([car(1, 0, 101.8), car(2, 0, 101.5)]).map(e => e.id)).toEqual([2, 1])
  })

  it('reports how far a car has run past a gate it never crossed', () => {
    // Validated sector 0 (start → gate at z=300), but tracked on to z=340.
    const index = line.findIndex(p => p.x === 0 && p.z === 340)
    const missed = { ...car(1, 0, 340), checkpoint: 0, index }
    expect(standings.overrun(missed)).toBeCloseTo(40, 0)
    const fine = { ...car(1, 0, 340), index }
    expect(standings.overrun(fine)).toBe(0)
  })
})
