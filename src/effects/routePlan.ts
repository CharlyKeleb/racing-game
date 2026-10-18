/**
 * Where the route markers go: pure maths on the centreline and the measured
 * paved edges (numbers in, numbers out), so it's unit tested and has no
 * three.js scene in it.
 */

export interface LinePoint {
  x: number
  y: number
  z: number
}

export interface RoadEdges {
  /** Distance from each centreline point to the paved edge on its left / right, m (glTF: +X is left). */
  left: Float32Array
  right: Float32Array
}

/** Heading change over ±span points, signed: + turns left. */
export function signedBend(line: readonly LinePoint[], span: number): Float32Array {
  const n = line.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = line[(i - span + n) % n]
    const b = line[i]
    const c = line[(i + span) % n]
    // Heading atan2(x, z) grows turning from +Z toward +X, i.e. to the left.
    let d = Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z)
    if (d > Math.PI) d -= 2 * Math.PI
    if (d < -Math.PI) d += 2 * Math.PI
    out[i] = d
  }
  return out
}

/**
 * How far to slide each point toward its left (+) or right (−) to sit in the
 * middle of the paved road. The traced centreline can run off-centre (it
 * avoids edges, not centres, and pit lanes or pavements widen one side), so
 * arrows laid on it looked lopsided. Clamped, then smoothed over ±`smooth`
 * points so the arrows don't zigzag where an edge measure jumps.
 */
export function roadCentreShift(edges: RoadEdges, maxShift: number, smooth: number): Float32Array {
  const n = edges.left.length
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) raw[i] = Math.max(-maxShift, Math.min(maxShift, (edges.left[i] - edges.right[i]) / 2))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let k = -smooth; k <= smooth; k++) sum += raw[(i + k + n) % n]
    out[i] = sum / (2 * smooth + 1)
  }
  return out
}

export interface CornerSign {
  /** Centreline point the board stands beside. */
  index: number
  /** Which way the corner turns: +1 left, −1 right. Boards stand on the outside, chevrons point this way. */
  turn: 1 | -1
  /** Distance from the centreline to the board, toward the outside of the bend, m. */
  offset: number
}

export interface CornerSignOptions {
  /** Heading change over ±span points that makes a bend a corner, rad. */
  minBend: number
  span: number
  /** A corner turning at least this much in total, entry to exit (a hairpin), gets the long row of boards, rad. */
  hairpin: number
  /** Points between boards. */
  spacing: number
  /** Boards stand this far past the outside paved edge… */
  edgeGap: number
  /** …but never further than this from the centreline (wide run-off, plazas). */
  maxOffset: number
}

export const CORNER_SIGNS: CornerSignOptions = { minBend: 0.5, span: 5, hairpin: 2, spacing: 3, edgeGap: 1.2, maxOffset: 14 }

/**
 * Chevron boards on the outside of every real corner, like the ones lining a
 * circuit: one run of bends with the same turn direction is one corner, and
 * its boards are centred on the sharpest point — three of them, five on a
 * hairpin (judged by the corner's total turn, entry to exit: a local
 * ±20 m heading change can't tell a hairpin from a fast sweep).
 */
export function planCornerSigns(line: readonly LinePoint[], edges: RoadEdges, o: CornerSignOptions = CORNER_SIGNS): CornerSign[] {
  const n = line.length
  if (n < o.span * 2 + 3) return []
  const bend = signedBend(line, o.span)
  // Start scanning on a straight so a corner never straddles the seam.
  let start = 0
  for (let i = 0; i < n; i++) if (Math.abs(bend[i]) < o.minBend) { start = i; break }
  const signs: CornerSign[] = []
  let k = 0
  while (k < n) {
    const i = (start + k) % n
    if (Math.abs(bend[i]) < o.minBend) { k++; continue }
    const sign = Math.sign(bend[i])
    let peak = i, len = 0, first = i, last = i
    while (k < n) {
      const j = (start + k) % n
      if (Math.abs(bend[j]) < o.minBend || Math.sign(bend[j]) !== sign) break
      if (Math.abs(bend[j]) > Math.abs(bend[peak])) peak = j
      last = j
      k++
      len++
    }
    if (len === 0) { k++; continue }
    const turn = sign > 0 ? 1 : -1
    const boards = Math.abs(turnBetween(line, first, last)) >= o.hairpin ? 5 : 3
    for (let b = 0; b < boards; b++) {
      const index = (peak + (b - (boards - 1) / 2) * o.spacing + n) % n
      // Outside of a left turn is the right-hand edge.
      const edge = turn > 0 ? edges.right[index] : edges.left[index]
      signs.push({ index, turn, offset: Math.min(edge + o.edgeGap, o.maxOffset) })
    }
  }
  return signs
}

/** Total heading change walking the line from point `from` to point `to`, rad (+ = left). */
function turnBetween(line: readonly LinePoint[], from: number, to: number): number {
  const n = line.length
  let total = 0
  let prev = NaN
  for (let i = from; ; i = (i + 1) % n) {
    const a = line[i], b = line[(i + 1) % n]
    const h = Math.atan2(b.x - a.x, b.z - a.z)
    if (!Number.isNaN(prev)) {
      let d = h - prev
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      total += d
    }
    prev = h
    if (i === to) break
  }
  return total
}
