/**
 * Where the car is along the track's centreline. Pure (plain {x,y,z} points)
 * so it can run on a server later. Searches a window around the last match, so
 * it's O(window) per call instead of O(line length), and can't jump to a
 * parallel stretch of track.
 */
export interface Point3 {
  x: number
  y: number
  z: number
}

const WINDOW = 40 // points either side (~160 m at 4 m spacing)

export class TrackProgress {
  /** Index of the nearest centreline point. */
  index = 0
  private readonly line: readonly Point3[]
  private initialised = false

  constructor(line: readonly Point3[]) {
    this.line = line
  }

  update(x: number, z: number): number {
    const n = this.line.length
    if (n === 0) return 0
    let best = this.index
    let bestD = Infinity
    if (!this.initialised) {
      for (let i = 0; i < n; i++) {
        const d = dist2(this.line[i], x, z)
        if (d < bestD) { bestD = d; best = i }
      }
      this.initialised = true
    } else {
      for (let k = -WINDOW; k <= WINDOW; k++) {
        const i = (this.index + k + n) % n
        const d = dist2(this.line[i], x, z)
        if (d < bestD) { bestD = d; best = i }
      }
    }
    this.index = best
    return best
  }

  /** Unit direction of travel at `index` (XZ). */
  tangent(index = this.index): { x: number; z: number } {
    const n = this.line.length
    const a = this.line[(index - 1 + n) % n]
    const b = this.line[(index + 1) % n]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const l = Math.hypot(dx, dz) || 1
    return { x: dx / l, z: dz / l }
  }

  /** After a teleport (respawn): next update does a full search. */
  reset(): void {
    this.initialised = false
  }
}

function dist2(p: Point3, x: number, z: number): number {
  const dx = p.x - x
  const dz = p.z - z
  return dx * dx + dz * dz
}
