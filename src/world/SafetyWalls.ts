/**
 * Invisible walls where the world ends. Track collision is trimmed to a band
 * around the circuit, and in many places (street circuits especially) the
 * floor stops a few metres past the kerb with no barrier, so a car that ran
 * wide dropped off the edge of the world. This marches out from the
 * centreline on both sides until the floor runs out and stands a wall just
 * inside that edge. Where the floor carries on (run-off, paddock, another
 * stretch of track) there's no wall, so nothing drivable is ever closed off.
 *
 * Pure: a height probe in, triangle soup out (built once at track load).
 */

export interface WallPoint {
  x: number
  y: number
  z: number
}

/** Height of the static floor near (x, nearY, z), or null if there's nothing there. */
export type FloorProbe = (x: number, nearY: number, z: number) => number | null

const STEP = 2
/** Start probing here: inside this the road itself is always solid. */
const FIRST = 4
/** No wall where the floor carries on this far; that's open run-off, not an edge. */
const MAX = 70
/** How far past the last solid probe the wall stands (the floor ends somewhere in the next step). */
const PAST = 0.5
/** Wall extent around the floor height: deep enough to catch a car mid-drop, tall enough to stop a launched one. */
const BELOW = 3
const ABOVE = 4
/** A floor this much lower one probe further out is a drop (a quay, a ledge), not a slope: an edge too. */
const DROP = 2
/** Neighbouring edges further apart than this aren't joined (the wall would cut across the floor). */
const MAX_JUMP = 6

export interface SafetyWallMesh {
  vertices: Float32Array
  indices: Uint32Array
  /** Wall segments built, for logging. */
  segments: number
}

/** Distance to the floor's edge along one side, and the floor height there; null when it carries on. */
function edgeAt(p: WallPoint, nx: number, nz: number, probe: FloorProbe): { d: number; y: number } | null {
  // No floor under the centreline itself means the collision isn't there (or
  // isn't queryable yet), not that the world ends: never wall in the road.
  const road = probe(p.x, p.y, p.z)
  if (road === null) return null
  let y = road
  let misses = 0
  for (let d = FIRST; d <= MAX; d += STEP) {
    const h = probe(p.x + nx * d, y, p.z + nz * d)
    // Marina Bay's promenade falls away to the ground plane by the water: the
    // floor carries on 8 m down, which is still falling off the track.
    if (h !== null && h < y - DROP) return { d: Math.max(FIRST - STEP, d - STEP) + PAST, y }
    if (h === null) {
      // Two misses in a row: a one-probe hole is a seam, not the end of the world.
      if (++misses === 2) return { d: Math.max(FIRST - STEP, d - 2 * STEP) + PAST, y }
    } else {
      misses = 0
      y = h
    }
  }
  return null
}

export function planSafetyWalls(line: readonly WallPoint[], probe: FloorProbe): SafetyWallMesh {
  const n = line.length
  // Per point and side: wall foot position and floor height, or NaN for none.
  const foot = new Float32Array(n * 2 * 4).fill(NaN)
  for (let i = 0; i < n; i++) {
    const a = line[(i - 1 + n) % n], b = line[(i + 1) % n], p = line[i]
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1
    // Left of travel (glTF: +X left): forward (0, 1) → left (1, 0).
    const lx = (b.z - a.z) / l, lz = -(b.x - a.x) / l
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1
      const edge = edgeAt(p, lx * sign, lz * sign, probe)
      if (!edge) continue
      const o = (i * 2 + side) * 4
      foot[o] = p.x + lx * sign * edge.d
      foot[o + 1] = edge.y
      foot[o + 2] = p.z + lz * sign * edge.d
      foot[o + 3] = edge.d
    }
  }
  const vertices: number[] = []
  const indices: number[] = []
  let segments = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    for (let side = 0; side < 2; side++) {
      const a = (i * 2 + side) * 4, b = (j * 2 + side) * 4
      if (Number.isNaN(foot[a]) || Number.isNaN(foot[b])) continue
      if (Math.abs(foot[a + 3] - foot[b + 3]) > MAX_JUMP) continue
      // On the inside of a corner tighter than the edge distance the wall would
      // cross the road: keep its midpoint at least as far from the line as its ends.
      const mx = (foot[a] + foot[b]) / 2, mz = (foot[a + 2] + foot[b + 2]) / 2
      const mid = Math.min(Math.hypot(mx - line[i].x, mz - line[i].z), Math.hypot(mx - line[j].x, mz - line[j].z))
      if (mid < Math.min(foot[a + 3], foot[b + 3]) - 2) continue
      const v = vertices.length / 3
      vertices.push(
        foot[a], foot[a + 1] - BELOW, foot[a + 2],
        foot[a], foot[a + 1] + ABOVE, foot[a + 2],
        foot[b], foot[b + 1] - BELOW, foot[b + 2],
        foot[b], foot[b + 1] + ABOVE, foot[b + 2],
      )
      // Both windings: a trimesh only collides from the front face side in some cases.
      indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3, v, v + 2, v + 1, v + 2, v + 3, v + 1)
      segments++
    }
  }
  return { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices), segments }
}
