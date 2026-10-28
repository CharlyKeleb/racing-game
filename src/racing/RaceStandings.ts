import type { Point3 } from './TrackProgress'

export interface RaceEntry {
  id: number
  name: string
  player: boolean
  lap: number
  checkpoint: number
  index: number
  finishMs: number | null
  x?: number
  z?: number
}
/** Metres past an uncrossed gate before the HUD says the checkpoint was missed. */
export const MISSED_GATE_METRES = 40
/** A tracked index within this many metres of the car is trusted to narrow the projection. */
const HINT_RADIUS = 30
/** Centreline metres either side of the tracked index searched for the exact projection. */
const HINT_WINDOW = 80
/**
 * Metres a car must be ahead before it takes a place from the car that held it.
 * Side by side, the projections of two cars cross back and forth every frame,
 * and the HUD flickered between positions.
 */
const OVERTAKE_MARGIN = 0.75

export interface Standing { id: number; name: string; player: boolean; position: number; finishMs: number | null; gapMeters: number; gapLaps: number; gapMs: number | null }

/** Gate-validated progress: skipping a corner cannot promote a car into a later sector. */
export class RaceStandings {
  private readonly segmentLengths: Float64Array
  private readonly routeMetres: Float64Array
  private readonly sectorStarts: Float64Array
  private readonly gates: number[]
  private readonly sectorLengths: number[]
  readonly lapLength: number
  private readonly line: readonly Point3[]
  /** Last snapshot's order (id → index), for overtake hysteresis. */
  private readonly places = new Map<number, number>()
  /**
   * Last projection per car, reused while its state is unchanged: the player
   * and every rival are measured several times a tick (AI gaps, HUD, the
   * snapshot), and a car that hasn't moved needn't be projected again.
   */
  private readonly memo = new Map<number, { x: number; z: number; index: number; checkpoint: number; metres: number }>()
  /** Projections actually computed (memo misses), for tests and profiling. */
  projections = 0
  constructor(line: readonly Point3[], checkpoints: readonly { position: Point3 }[]) {
    this.line = line
    this.segmentLengths = new Float64Array(line.length)
    this.routeMetres = new Float64Array(line.length + 1)
    for (let i = 0; i < line.length; i++) {
      const a = line[i], b = line[(i + 1) % line.length]
      this.segmentLengths[i] = Math.hypot(b.x - a.x, b.z - a.z)
      this.routeMetres[i + 1] = this.routeMetres[i] + this.segmentLengths[i]
    }
    this.gates = checkpoints.map(({ position }) => {
      let best = 0, distance = Infinity
      for (let i = 0; i < line.length; i++) {
        const d = (line[i].x - position.x) ** 2 + (line[i].z - position.z) ** 2
        if (d < distance) { best = i; distance = d }
      }
      return best
    })
    this.sectorLengths = this.gates.map((start, gate) => {
      const end = this.gates[(gate + 1) % this.gates.length]
      return this.metresFrom(start, (end - start + line.length) % line.length || line.length, 0)
    })
    this.sectorStarts = new Float64Array(this.gates.length + 1)
    for (let i = 0; i < this.gates.length; i++) this.sectorStarts[i + 1] = this.sectorStarts[i] + this.sectorLengths[i]
    this.lapLength = this.sectorStarts[this.gates.length]
  }
  /**
   * Metres travelled into the car's validated sector, measured along the
   * centreline (point spacing is uneven, so counting points would skew gaps by
   * metres). Negative while still behind the start line on the grid.
   */
  private sectorMetres(entry: RaceEntry): number {
    const x = entry.x ?? NaN, z = entry.z ?? NaN
    let m = this.memo.get(entry.id)
    // NaN never equals itself, so entries without a position always recompute (they're cheap).
    if (m && m.x === x && m.z === z && m.index === entry.index && m.checkpoint === entry.checkpoint) return m.metres
    const metres = this.project(entry)
    this.projections++
    if (!m) this.memo.set(entry.id, m = { x, z, index: entry.index, checkpoint: entry.checkpoint, metres })
    else { m.x = x; m.z = z; m.index = entry.index; m.checkpoint = entry.checkpoint; m.metres = metres }
    return metres
  }

  private project(entry: RaceEntry): number {
    const n = this.line.length, count = this.gates.length
    const gate = entry.checkpoint
    const start = this.gates[gate], end = this.gates[(gate + 1) % count]
    const span = (end - start + n) % n || n
    const length = this.sectorLengths[gate]
    if (entry.x === undefined || entry.z === undefined) {
      const k = (entry.index - start + n) % n
      return k > span ? 0 : this.metresFrom(start, k, 0)
    }
    // Continuous segment projection within the validated sector. Nearest
    // waypoint ranking quantised overtakes to ~4 m and reset at sector ends.
    // The car's tracked centreline index (TrackProgress, which follows the car
    // and can't jump) narrows the search: a whole-sector nearest match latched
    // onto a parallel stretch where the track folds back on itself.
    let from = 0, to = span
    const hint = this.line[entry.index]
    if (hint && (entry.x - hint.x) ** 2 + (entry.z - hint.z) ** 2 < HINT_RADIUS * HINT_RADIUS) {
      const k = (entry.index - start + n) % n
      const centre = k <= span ? k : n - k < k - span ? 0 : span
      from = centre
      for (let m = 0; from > 0 && m < HINT_WINDOW; from--) m += this.segment((start + from - 1) % n)
      to = centre
      for (let m = 0; to < span && m < HINT_WINDOW; to++) m += this.segment((start + to) % n)
    }
    let best = Infinity, metres = 0
    let along = from > 0 ? this.metresFrom(start, from, 0) : 0
    for (let k = from; k < to; k++) {
      const a = this.line[(start + k) % n], b = this.line[(start + k + 1) % n]
      const dx = b.x - a.x, dz = b.z - a.z
      const segment = this.segment((start + k) % n)
      const t = Math.max(0, Math.min(1, ((entry.x - a.x) * dx + (entry.z - a.z) * dz) / (segment * segment || 1)))
      const d = (entry.x - a.x - dx * t) ** 2 + (entry.z - a.z - dz * t) ** 2
      if (d < best) { best = d; metres = along + t * segment }
      along += segment
    }
    if (gate === 0 && metres < 0.01) {
      // On the grid: how far behind the line, along the first segment.
      const a = this.line[start], b = this.line[(start + 1) % n]
      const dx = b.x - a.x, dz = b.z - a.z
      const segment = Math.hypot(dx, dz) || 1
      metres = Math.min(0, ((entry.x - a.x) * dx + (entry.z - a.z) * dz) / segment)
    }
    return Math.min(length - 0.000001, metres)
  }

  /**
   * Centreline index to put a recovering car back on: `back` points behind
   * where it is, but inside its validated sector, so a reset never skips a
   * gate or costs more than a few metres.
   */
  recoveryIndex(entry: RaceEntry, back = 2): number {
    const n = this.line.length, count = this.gates.length
    const start = this.gates[entry.checkpoint], end = this.gates[(entry.checkpoint + 1) % count]
    const span = (end - start + n) % n || n
    const k = (entry.index - start + n) % n
    const inside = k <= span ? k : n - k < k - span ? 0 : span
    return (start + Math.max(0, Math.min(span - 1, inside - back))) % n
  }

  /** Length of the centreline segment from point i to the next. */
  private segment(i: number): number {
    return this.segmentLengths[i]
  }

  /** Constant-time centreline distance, including a sector crossing the finish. */
  private metresFrom(start: number, k: number, t: number): number {
    const n = this.line.length
    const steps = Math.min(n, Math.max(0, k))
    const end = (start + steps) % n
    const whole = steps === n ? this.routeMetres[n] : end >= start
      ? this.routeMetres[end] - this.routeMetres[start]
      : this.routeMetres[n] - this.routeMetres[start] + this.routeMetres[end]
    return whole + (steps < n ? t * this.segmentLengths[end] : 0)
  }

  /** Sectors completed plus the share of the current one; ranks cars. */
  progress(entry: RaceEntry): number {
    const count = this.gates.length
    const length = this.sectorLengths[entry.checkpoint] || 1
    return (Math.max(1, entry.lap) - 1) * count + entry.checkpoint + this.sectorMetres(entry) / length
  }

  /** Metres from the start of the race along the centreline; gaps are differences of this. */
  distance(entry: RaceEntry): number {
    if (entry.finishMs !== null) return Math.max(1, entry.lap) * this.lapLength
    let distance = (Math.max(1, entry.lap) - 1) * this.lapLength
    distance += this.sectorStarts[entry.checkpoint]
    return distance + this.sectorMetres(entry)
  }
  /**
   * Metres a car's tracked centreline position has run past the end of its
   * validated sector: > 0 means it went on without passing the next gate.
   */
  overrun(entry: RaceEntry): number {
    const n = this.line.length, count = this.gates.length
    const start = this.gates[entry.checkpoint], end = this.gates[(entry.checkpoint + 1) % count]
    const span = (end - start + n) % n || n
    const k = (entry.index - start + n) % n
    // Past the end, but nearer to it than to the sector start (i.e. not behind it).
    if (k <= span || k - span > n - k) return 0
    let metres = 0
    for (let i = span; i < k; i++) metres += this.segment((start + i) % n)
    return metres
  }

  snapshot(entries: readonly RaceEntry[]): Standing[] {
    // Project each car once, rather than on every sort comparison and gap lookup.
    const ranked = entries.map(entry => {
      const sector = this.sectorMetres(entry)
      return {
        entry,
        progress: (Math.max(1, entry.lap) - 1) * this.gates.length + entry.checkpoint + sector / (this.sectorLengths[entry.checkpoint] || 1),
        distance: entry.finishMs !== null ? Math.max(1, entry.lap) * this.lapLength :
          (Math.max(1, entry.lap) - 1) * this.lapLength + this.sectorStarts[entry.checkpoint] + sector,
      }
    })
    ranked.sort((a, b) => {
      if (a.entry.finishMs !== null || b.entry.finishMs !== null) {
        if (a.entry.finishMs === null) return 1
        if (b.entry.finishMs === null) return -1
        return a.entry.finishMs - b.entry.finishMs || a.entry.id - b.entry.id
      }
      return b.progress - a.progress || a.entry.id - b.entry.id
    })
    // A car keeps a place it held until the one behind is clearly past.
    for (let i = 1; i < ranked.length; i++) {
      const ahead = ranked[i - 1], behind = ranked[i]
      if (ahead.entry.finishMs !== null || behind.entry.finishMs !== null) continue
      const held = this.places.get(behind.entry.id), other = this.places.get(ahead.entry.id)
      if (held === undefined || other === undefined || held > other) continue
      if (ahead.distance - behind.distance < OVERTAKE_MARGIN) {
        ranked[i - 1] = behind; ranked[i] = ahead
      }
    }
    this.places.clear()
    ranked.forEach((row, i) => this.places.set(row.entry.id, i))
    const sorted = ranked.map(row => row.entry)
    const leader = sorted[0]
    const leaderDistance = ranked[0]?.distance ?? 0
    return sorted.map((e, i) => {
      const gapMeters = Math.max(0, leaderDistance - ranked[i].distance)
      return { id: e.id, name: e.name, player: e.player, position: i + 1, finishMs: e.finishMs, gapMeters, gapLaps: Math.floor(gapMeters / this.lapLength), gapMs: e.finishMs !== null && leader.finishMs !== null ? e.finishMs - leader.finishMs : null }
    })
  }

  /** Forget held places (a new race). */
  reset(): void {
    this.places.clear()
    this.memo.clear()
  }
}
