/**
 * Invisible walls where the world ends. Track collision is trimmed to a band
 * around the circuit, and in many places (street circuits especially) the
 * floor stops a few metres past the kerb with no barrier, so a car that ran
 * wide dropped off the edge of the world. This marches out from the
 * centreline on both sides until the floor runs out, drops away or runs
 * under something too low to drive under, and stands a wall at that edge. A barrier gets one at its
 * face too, taller than the barrier, so a car hitting it at an angle can't ride up and over. Where the
 * floor carries on (run-off, paddock, another stretch of track) there's no
 * wall, so nothing drivable is ever closed off.
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
/** Free height (m) above the floor at (x, floorY, z) up to `max`, or null when nothing is that close. */
export type HeadroomProbe = (x: number, floorY: number, z: number, max: number) => number | null
/** Distance along (dx, 0, dz) from (x, y, z) to the face of a track barrier (wall, armco, fence) within `max`, or null. */
export type BarrierProbe = (x: number, y: number, z: number, dx: number, dz: number, max: number) => number | null

export interface SafetyWallProbes {
  floor: FloorProbe
  headroom?: HeadroomProbe
  barrier?: BarrierProbe
}

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
/**
 * Less free height than this over the floor is solid, not a roof to drive under: an edge too. The
 * floor probe looks under anything 1.5 m up (station canopies), and Canyon's road mesh runs on
 * beneath the rock, so the cliff read as a roof over more road, got no wall, and cars rode up its
 * 30-45° face into the air. City's tram-stop canopies, ~2.9 m over the road, are roofs.
 */
const CLEARANCE = 2.6
/** Halvings that place an obstruction's wall within STEP / 2^n of where it starts. */
const REFINE = 3
/**
 * Barriers are found at this height over the floor: higher than a kerb. Marina Bay's are 1.4 m
 * concrete only ~0.5 m thick, which the floor probes step straight over, so they got no wall.
 */
const BARRIER_RISE = 0.5
/** A barrier must carry on this far along the road either side: a lamp post or bollard gets no wall. */
const BARRIER_RUN = 2
/** How far the barrier's face may wander either side of that (a barrier on a curve, a kink in it). */
const BARRIER_SLACK = 1.5
/** A barrier's foot can flare out like a ramp (Marina Bay's do): the wall stands in front of it, found at this height. */
const BARRIER_FOOT = 0.1
/** The wall stands this far in front of the barrier's face, so the car meets it first. */
const BARRIER_GAP = 0.05
/** Neighbouring edges further apart than this aren't joined (the wall would cut across the floor). */
const MAX_JUMP = 6
/** Longest wall standing a side street's edge (where it runs on past MAX, or for good). */
const STEP_MAX = 40

export interface SafetyWallMesh {
  vertices: Float32Array
  indices: Uint32Array
  /** Wall segments built, for logging. */
  segments: number
}

interface Edge {
  d: number
  y: number
  /** A barrier's face, where the floor carries on beyond (vs the floor ending or running under rock). */
  barrier: boolean
}

/** Distance to the floor's edge along one side, and the floor height there; null when it carries on. */
function edgeAt(p: WallPoint, nx: number, nz: number, { floor: probe, headroom, barrier }: SafetyWallProbes): Edge | null {
  // No floor under the centreline itself means the collision isn't there (or
  // isn't queryable yet), not that the world ends: never wall in the road.
  const road = probe(p.x, p.y, p.z)
  if (road === null) return null
  let y = road
  let misses = 0
  /** Where `blocked` starts between the last clear probe and d, so the wall takes no road. */
  const start = (d: number, blocked: (x: number, z: number) => boolean): Edge => {
    let clear = d - STEP, far = d
    for (let k = 0; k < REFINE; k++) {
      const m = (clear + far) / 2
      if (blocked(p.x + nx * m, p.z + nz * m)) far = m
      else clear = m
    }
    return { d: Math.max(FIRST - STEP, clear), y, barrier: false }
  }
  const low = (x: number, z: number) => {
    const f = probe(x, y, z)
    return f === null || headroom!(x, f, z, CLEARANCE) !== null
  }
  /** The face of a barrier between `from` and `to` (m out), if it runs on along the road; null otherwise. */
  const face = (from: number, to: number) => {
    const x = p.x + nx * from, z = p.z + nz * from, at = barrier!(x, y + BARRIER_RISE, z, nx, nz, to - from)
    if (at === null) return null
    // Along the road (the normal turned a quarter) either side, so a post or a bollard is no wall.
    for (const s of [-BARRIER_RUN, BARRIER_RUN]) {
      const t = barrier!(x - nz * s, y + BARRIER_RISE, z + nx * s, nx, nz, at + BARRIER_SLACK)
      if (t === null || t < at - BARRIER_SLACK) return null
    }
    const foot = barrier!(x, y + BARRIER_FOOT, z, nx, nz, at)
    return { d: Math.max(1, from + Math.min(at, foot ?? at) - BARRIER_GAP), y, barrier: true }
  }
  for (let d = FIRST; d <= MAX; d += STEP) {
    const x = p.x + nx * d, z = p.z + nz * d
    if (barrier) {
      const hit = face(d === FIRST ? 0 : d - STEP, d)
      if (hit) return hit
    }
    const h = probe(x, y, z)
    // Marina Bay's promenade falls away to the ground plane by the water: the
    // floor carries on 8 m down, which is still falling off the track.
    if (h !== null && h < y - DROP) return { d: Math.max(FIRST - STEP, d - STEP) + PAST, y, barrier: false }
    if (h !== null && headroom && headroom(x, h, z, CLEARANCE) !== null) return start(d, low)
    if (h === null) {
      // Two misses in a row: a one-probe hole is a seam, not the end of the world.
      if (++misses === 2) return { d: Math.max(FIRST - STEP, d - 2 * STEP) + PAST, y, barrier: false }
    } else {
      misses = 0
      y = h
    }
  }
  return null
}

export function planSafetyWalls(line: readonly WallPoint[], probes: SafetyWallProbes): SafetyWallMesh {
  const probe = probes.floor
  const n = line.length
  // Per point and side: wall foot position, floor height, distance and 1 for a barrier; NaN for none.
  const S = 5
  const foot = new Float32Array(n * 2 * S).fill(NaN)
  for (let i = 0; i < n; i++) {
    const a = line[(i - 1 + n) % n], b = line[(i + 1) % n], p = line[i]
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1
    // Left of travel (glTF: +X left): forward (0, 1) → left (1, 0).
    const lx = (b.z - a.z) / l, lz = -(b.x - a.x) / l
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1
      const edge = edgeAt(p, lx * sign, lz * sign, probes)
      if (!edge) continue
      const o = (i * 2 + side) * S
      foot[o] = p.x + lx * sign * edge.d
      foot[o + 1] = edge.y
      foot[o + 2] = p.z + lz * sign * edge.d
      foot[o + 3] = edge.d
      foot[o + 4] = edge.barrier ? 1 : 0
    }
  }
  const vertices: number[] = []
  const indices: number[] = []
  let segments = 0
  const wall = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const v = vertices.length / 3
    vertices.push(ax, ay - BELOW, az, ax, ay + ABOVE, az, bx, by - BELOW, bz, bx, by + ABOVE, bz)
    // Both windings: a trimesh only collides from the front face side in some cases.
    indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3, v, v + 2, v + 1, v + 2, v + 3, v + 1)
    segments++
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    for (let side = 0; side < 2; side++) {
      const a = (i * 2 + side) * S, b = (j * 2 + side) * S
      if (Number.isNaN(foot[a]) && Number.isNaN(foot[b])) continue
      // Where a barrier stops (a pit entry, a gap onto run-off) the floor carries on: end its wall
      // there, never join it to the floor's edge further out (that would cut across the gap).
      if ((foot[a + 4] === 1 || foot[b + 4] === 1) && (foot[a + 4] !== foot[b + 4] || Math.abs(foot[a + 3] - foot[b + 3]) > MAX_JUMP)) continue
      // No edge on one side means the floor carries on past MAX (a side street).
      const da = Number.isNaN(foot[a]) ? MAX : foot[a + 3], db = Number.isNaN(foot[b]) ? MAX : foot[b + 3]
      if (Math.abs(da - db) > MAX_JUMP) {
        // A side street or plaza opening off the road: its far edge runs along
        // the probes, so no probe finds it. Wall the step instead, out along the
        // nearer point's probe (past its edge, so over no floor) to the farther
        // edge's distance, at most STEP_MAX past it.
        const [near, at, far] = da < db ? [a, i, j] : [b, j, i]
        const d0 = foot[near + 3], d = Math.min(Math.max(da, db), d0 + STEP_MAX), y = foot[near + 1]
        const ux = (foot[near] - line[at].x) / d0, uz = (foot[near + 2] - line[at].z) / d0
        // The street's side lies somewhere between the two probes: slide over
        // from the near one while the wall's middle and far end still stand
        // over nothing (its near end may cross a flared corner).
        let s = 0
        const voidAt = (t: number, dist: number) => probe(line[at].x + (line[far].x - line[at].x) * t + ux * dist, y, line[at].z + (line[far].z - line[at].z) * t + uz * dist) === null
        while (s < 0.875 && voidAt(s + 0.125, (d0 + d) / 2) && voidAt(s + 0.125, d - 1)) s += 0.125
        const ox = (line[far].x - line[at].x) * s, oz = (line[far].z - line[at].z) * s
        wall(line[at].x + ox + ux * d0, y, line[at].z + oz + uz * d0, line[at].x + ox + ux * d, y, line[at].z + oz + uz * d)
        continue
      }
      // On the inside of a corner tighter than the edge distance the wall would
      // cross the road: keep its midpoint at least as far from the line as its ends.
      const mx = (foot[a] + foot[b]) / 2, mz = (foot[a + 2] + foot[b + 2]) / 2
      const mid = Math.min(Math.hypot(mx - line[i].x, mz - line[i].z), Math.hypot(mx - line[j].x, mz - line[j].z))
      if (mid < Math.min(foot[a + 3], foot[b + 3]) - 2) continue
      wall(foot[a], foot[a + 1], foot[a + 2], foot[b], foot[b + 1], foot[b + 2])
    }
  }
  return { vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices), segments }
}
