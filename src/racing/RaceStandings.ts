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
export interface Standing { id: number; name: string; player: boolean; position: number; finishMs: number | null; gapMeters: number; gapLaps: number; gapMs: number | null }

/** Gate-validated progress: skipping a corner cannot promote a car into a later sector. */
export class RaceStandings {
  private readonly gates: number[]
  private readonly sectorLengths: number[]
  readonly lapLength: number
  private readonly line: readonly Point3[]
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
  progress(entry: RaceEntry): number {
    const n = this.line.length, count = this.gates.length
    const gate = entry.checkpoint
    const start = this.gates[gate], end = this.gates[(gate + 1) % count]
    const span = (end - start + n) % n || n
    let distance = (entry.index - start + n) % n
    if (entry.x !== undefined && entry.z !== undefined) {
      let best = Infinity
      distance = 0
      // Continuous segment projection within the validated sector. Nearest
      // waypoint ranking quantised overtakes to ~4 m and reset at sector ends.
      for (let k = 0; k < span; k++) {
        const a = this.line[(start + k) % n], b = this.line[(start + k + 1) % n]
        const dx = b.x - a.x, dz = b.z - a.z
        const t = Math.max(0, Math.min(1, ((entry.x - a.x) * dx + (entry.z - a.z) * dz) / (dx * dx + dz * dz || 1)))
        const d = (entry.x - a.x - dx * t) ** 2 + (entry.z - a.z - dz * t) ** 2
        if (d < best) { best = d; distance = k + t }
      }
      if (gate === 0 && distance < 0.01) {
        const a = this.line[start], b = this.line[(start + 1) % n]
        const dx = b.x - a.x, dz = b.z - a.z
        const behind = ((entry.x - a.x) * dx + (entry.z - a.z) * dz) / (dx * dx + dz * dz || 1)
        distance = Math.min(0, behind)
      }
      distance = Math.min(span - 0.000001, distance)
    } else if (distance > span) distance = 0
    return (Math.max(1, entry.lap) - 1) * count + gate + distance / span
  }
  distance(entry: RaceEntry): number {
    if (entry.finishMs !== null) return Math.max(1, entry.lap) * this.lapLength
    const progress = this.progress(entry)
    if (progress < 0) return progress * this.sectorLengths[0]
    const whole = Math.floor(progress)
    const lap = Math.floor(whole / this.gates.length)
    const gate = whole % this.gates.length
    let distance = lap * this.lapLength
    for (let i = 0; i < gate; i++) distance += this.sectorLengths[i]
    return distance + (progress - whole) * this.sectorLengths[gate]
  }
  snapshot(entries: readonly RaceEntry[]): Standing[] {
    const sorted = [...entries].sort((a, b) => {
      if (a.finishMs !== null || b.finishMs !== null) {
        if (a.finishMs === null) return 1
        if (b.finishMs === null) return -1
        return a.finishMs - b.finishMs || a.id - b.id
      }
      return this.progress(b) - this.progress(a) || a.id - b.id
    })
    const leader = sorted[0]
    const leaderDistance = leader ? this.distance(leader) : 0
    return sorted.map((e, i) => {
      const gapMeters = Math.max(0, leaderDistance - this.distance(e))
      return { id: e.id, name: e.name, player: e.player, position: i + 1, finishMs: e.finishMs, gapMeters, gapLaps: Math.floor(gapMeters / this.lapLength), gapMs: e.finishMs !== null && leader.finishMs !== null ? e.finishMs - leader.finishMs : null }
    })
  }
}
