import { describe, expect, it } from 'vitest'
import { planCornerSigns, roadCentreShift, signedBend } from '../src/effects/routePlan'

/**
 * A stadium loop, 4 m spacing: up a 400 m straight (+Z), a right-hand
 * hairpin (r = 30 m), back down the other straight, another right-hander.
 * glTF +X is left, so turning right swings toward -X.
 */
function circuit() {
  const pts: { x: number; y: number; z: number }[] = []
  for (let z = 0; z < 400; z += 4) pts.push({ x: 0, y: 0, z })
  for (let a = 0; a < Math.PI; a += 4 / 30) pts.push({ x: -30 + 30 * Math.cos(a), y: 0, z: 400 + 30 * Math.sin(a) })
  for (let z = 400; z > 0; z -= 4) pts.push({ x: -60, y: 0, z })
  for (let a = Math.PI; a < 2 * Math.PI; a += 4 / 30) pts.push({ x: -30 + 30 * Math.cos(a), y: 0, z: 30 * Math.sin(a) })
  return pts
}

describe('route plan', () => {
  it('signs a left bend positive and a right bend negative', () => {
    const line = circuit()
    const bend = signedBend(line, 5)
    expect(bend[50]).toBeCloseTo(0, 3) // straight
    expect(bend[100 + 12]).toBeLessThan(-0.5) // in the first hairpin
  })

  it('slides toward the middle of the road and smooths a one-point jump', () => {
    const n = 40
    const edges = { left: new Float32Array(n).fill(6), right: new Float32Array(n).fill(2) }
    edges.left[20] = 30 // a pit entry widens one side for a single point
    const shift = roadCentreShift(edges, 4, 3)
    expect(shift[5]).toBeCloseTo(2) // middle is 2 m to the left
    expect(shift[20]).toBeLessThan(2.5) // clamped and smoothed, not a 4 m lurch
  })

  it('puts boards on the outside of each corner and none on the straights', () => {
    const line = circuit()
    const n = line.length
    const edges = { left: new Float32Array(n).fill(5), right: new Float32Array(n).fill(5) }
    const signs = planCornerSigns(line, edges)
    // Two hairpins, five boards each, all on the outside of a right-hander.
    expect(signs.length).toBe(10)
    for (const s of signs) {
      expect(s.turn).toBe(-1)
      expect(s.offset).toBeCloseTo(6.2) // 5 m edge + 1.2 m gap
    }
    // Nothing along the middle of either straight.
    expect(signs.filter((s) => (s.index > 15 && s.index < 85) || (s.index > 140 && s.index < 210))).toEqual([])
  })

  it('keeps boards out of wide plazas', () => {
    const line = circuit()
    const n = line.length
    const edges = { left: new Float32Array(n).fill(30), right: new Float32Array(n).fill(30) }
    for (const s of planCornerSigns(line, edges)) expect(s.offset).toBe(14)
  })
})
