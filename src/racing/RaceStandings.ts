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
  private readonly gates: number[]
  private readonly sectorLengths: number[]
  readonly lapLength: number
  private readonly line: readonly Point3[]
  /** Last snapshot's order (id → index), for overtake hysteresis. */
  private readonly places = new Map<number, number>()
  constructor(line: readonly Point3[], checkpoints: readonly { position: Point3 }[]) {
    this.line = line
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
      let length = 0
      for (let i = start; ; i = (i + 1) % line.length) {
        const next = (i + 1) % line.length
        length += Math.hypot(line[next].x - line[i].x, line[next].z - line[i].z)
        if (next === end) break
      }
      return length
    })
    this.lapLength = this.sectorLengths.reduce((sum, length) => sum + length, 0)
  }
  /**
   * Metres travelled into the car's validated sector, measured along the
   * centreline (point spacing is uneven, so counting points would skew gaps by
   * metres). Negative while still behind the start line on the grid.
   */
  private sectorMetres(entry: RaceEntry): number {
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
      const segment = Math.hypot(dx, dz)
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
    const a = this.line[i], b = this.line[(i + 1) % this.line.length]
    return Math.hypot(b.x - a.x, b.z - a.z)
  }

  /** Centreline metres from point `start` over `k` whole segments plus `t` of the next. */
  private metresFrom(start: number, k: number, t: number): number {
    const n = this.line.length
    let metres = 0
    for (let i = 0; i <= k && i < n; i++) {
      const a = this.line[(start + i) % n], b = this.line[(start + i + 1) % n]
      const segment = Math.hypot(b.x - a.x, b.z - a.z)
      metres += i < k ? segment : t * segment
    }
    return metres
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
    for (let i = 0; i < entry.checkpoint; i++) distance += this.sectorLengths[i]
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
    const distances = new Map<number, number>()
    for (const e of entries) distances.set(e.id, this.distance(e))
    const sorted = [...entries].sort((a, b) => {
      if (a.finishMs !== null || b.finishMs !== null) {
        if (a.finishMs === null) return 1
        if (b.finishMs === null) return -1
        return a.finishMs - b.finishMs || a.id - b.id
      }
      return distances.get(b.id)! - distances.get(a.id)! || a.id - b.id
    })
    // A car keeps a place it held until the one behind is clearly past.
    for (let i = 1; i < sorted.length; i++) {
      const ahead = sorted[i - 1], behind = sorted[i]
      if (ahead.finishMs !== null || behind.finishMs !== null) continue
      const held = this.places.get(behind.id), other = this.places.get(ahead.id)
      if (held === undefined || other === undefined || held > other) continue
      if (distances.get(ahead.id)! - distances.get(behind.id)! < OVERTAKE_MARGIN) {
        sorted[i - 1] = behind; sorted[i] = ahead
      }
    }
    this.places.clear()
    sorted.forEach((e, i) => this.places.set(e.id, i))
    const leader = sorted[0]
    const leaderDistance = leader ? distances.get(leader.id)! : 0
    return sorted.map((e, i) => {
      const gapMeters = Math.max(0, leaderDistance - distances.get(e.id)!)
      return { id: e.id, name: e.name, player: e.player, position: i + 1, finishMs: e.finishMs, gapMeters, gapLaps: Math.floor(gapMeters / this.lapLength), gapMs: e.finishMs !== null && leader.finishMs !== null ? e.finishMs - leader.finishMs : null }
    })
  }

  /** Forget held places (a new race). */
  reset(): void {
    this.places.clear()
  }
}
