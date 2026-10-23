export interface RaceGate {
  index: number
  position: readonly [number, number, number]
  tangent: readonly [number, number, number]
  radius: number
}
export interface RacePosition { x: number; y: number; z: number }

/** Ordered swept-plane gates, evaluated only against authoritative physics positions.
 * This is practice validation, not a track-limits/shortcut anti-cheat system.
 */
export class RaceProgress {
  nextCheckpoint = 1
  readonly lapTicks: number[] = []
  finishTicks: number | null = null
  private lastLapTick = 0
  private x = 0
  private y = 0
  private z = 0
  private initialized = false

  constructor(private readonly gates: readonly RaceGate[], private readonly laps: number) {
    if (!Number.isInteger(laps) || laps < 1 || laps > 10 || gates.length < 2) throw new Error('Invalid race course')
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i]
      if (g.index !== i || !g.position.every(Number.isFinite) || !g.tangent.every(Number.isFinite)
        || !Number.isFinite(g.radius) || g.radius <= 0 || Math.hypot(g.tangent[0], g.tangent[2]) < .5) throw new Error('Invalid race gate')
    }
  }

  /** Countdown samples seed the sweep without awarding progress or time. */
  seed(p: RacePosition): void {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) throw new Error('Invalid authoritative position')
    this.x = p.x; this.y = p.y; this.z = p.z
    this.initialized = true
  }

  update(p: RacePosition, elapsedTicks: number): void {
    if (this.finishTicks !== null) return
    if (!this.initialized) { this.seed(p); return }
    const dx = p.x - this.x, dy = p.y - this.y, dz = p.z - this.z
    // A discontinuity in server physics must never become a credited gate crossing.
    if (!Number.isFinite(dx + dy + dz) || dx * dx + dy * dy + dz * dz > 16) throw new Error('Discontinuous authoritative position')
    const g = this.gates[this.nextCheckpoint]
    const before = (this.x - g.position[0]) * g.tangent[0] + (this.z - g.position[2]) * g.tangent[2]
    const after = (p.x - g.position[0]) * g.tangent[0] + (p.z - g.position[2]) * g.tangent[2]
    if (before <= 0 && after > 0) {
      const fraction = -before / (after - before)
      const x = this.x + dx * fraction - g.position[0]
      const z = this.z + dz * fraction - g.position[2]
      const y = this.y + dy * fraction - g.position[1]
      if (x * x + z * z <= g.radius * g.radius && Math.abs(y) <= 6) {
        if (this.nextCheckpoint === 0) {
          this.lapTicks.push(elapsedTicks - this.lastLapTick)
          this.lastLapTick = elapsedTicks
          if (this.lapTicks.length === this.laps) this.finishTicks = elapsedTicks
        }
        this.nextCheckpoint = (this.nextCheckpoint + 1) % this.gates.length
      }
    }
    this.seed(p)
  }
}
