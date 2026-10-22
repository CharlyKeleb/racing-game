import { describe, expect, it } from 'vitest'
import { BrakingGuide } from '../src/racing/BrakingGuide'
import { DrivingLine } from '../src/effects/DrivingLine'

function stadium(): { x: number; y: number; z: number }[] {
  const pts: { x: number; y: number; z: number }[] = []
  const R = 25, L = 600
  for (let z = 0; z < L; z += 4) pts.push({ x: R, y: 0, z })
  for (let a = 0; a < Math.PI; a += 4 / R) pts.push({ x: R * Math.cos(a), y: 0, z: L + R * Math.sin(a) })
  for (let z = L; z > 0; z -= 4) pts.push({ x: -R, y: 0, z })
  for (let a = Math.PI; a < 2 * Math.PI; a += 4 / R) pts.push({ x: R * Math.cos(a), y: 0, z: R * Math.sin(a) })
  return pts
}
const line = stadium()
const guide = new BrakingGuide(line, { grip: 1.25, downforcePerKg: 1.6 / 1420, brakeDecel: 22000 / 1420 })

/** Per drawn point: ribbon width (m), alpha and height. */
function sample(dl: DrivingLine) {
  const g = dl.mesh.geometry, pos = g.attributes.position.array as Float32Array, col = g.attributes.color.array as Float32Array
  const n = (g.drawRange.count / 6) + 1
  return Array.from({ length: n }, (_, k) => ({
    width: Math.hypot(pos[k * 6] - pos[k * 6 + 3], pos[k * 6 + 2] - pos[k * 6 + 5]),
    alpha: col[k * 8 + 3],
    y: pos[k * 6 + 1],
  }))
}

describe('driving line ribbon (#93)', () => {
  it('sits on the measured road, and widens from go to brake approaching the hairpin fast', () => {
    let rays = 0
    const dl = new DrivingLine(line, () => { rays++; return 1.5 })
    const start = line.findIndex((p) => p.z > 420)
    dl.update(guide, start, 60, false)
    const pts = sample(dl)
    expect(pts.length).toBe(70)
    expect(pts[10].y).toBeCloseTo(1.55, 2)
    const widths = pts.map((p) => +p.width.toFixed(2))
    expect(Math.min(...widths)).toBeCloseTo(0.45, 2)
    expect(Math.max(...widths)).toBeCloseTo(1.5, 2)
    // Heights are cached: a second update casts no new rays for the same points.
    const before = rays
    dl.update(guide, start, 60, false)
    expect(rays).toBe(before)
    dl.dispose()
  })

  it('"corners only" hides the middle of a straight but shows the corner', () => {
    const dl = new DrivingLine(line, () => null)
    dl.update(guide, 20, 30, true)
    expect(Math.max(...sample(dl).slice(5, 40).map((p) => p.alpha))).toBe(0)
    const before = line.findIndex((p) => p.z > 560)
    dl.update(guide, before, 30, true)
    expect(Math.max(...sample(dl).map((p) => p.alpha))).toBeGreaterThan(0.4)
    dl.dispose()
  })

  it('draws fewer points on Low', () => {
    const dl = new DrivingLine(line, () => null)
    dl.setQuality('low')
    dl.update(guide, 0, 30, false)
    expect(sample(dl).length).toBe(40)
    dl.dispose()
  })
})
