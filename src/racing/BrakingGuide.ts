import type { Point3 } from './TrackProgress'

/**
 * Learning aid (#93): target speeds along the centreline and whether, at the
 * car's current speed, each point ahead means accelerate, lift or brake. Pure
 * and numeric; it only ever colours a guide, never drives or changes grip.
 *
 * Same physics as the AI's planner (curvature + grip + downforce, then
 * backward braking passes) but with conservative grip shares, so it errs on
 * braking a little early. It follows the centreline, not an optimal racing
 * line: a guide to braking points and corner speeds, not a lap-time line.
 */

export type GuideCue = 0 | 1 | 2 // accelerate, lift, brake
export const GO: GuideCue = 0
export const LIFT: GuideCue = 1
export const BRAKE: GuideCue = 2

export interface GuideCar {
  /** Tyre grip coefficient (TireConfig.grip, build applied). */
  grip: number
  /** Downforce per kg, (N per (m/s)²) / kg. */
  downforcePerKg: number
  /** Brake force over mass, m/s². */
  brakeDecel: number
}

/** Share of the tyre's grip the guide plans to use: below the AI's, so it's easy to hit. */
const CORNER_GRIP_SHARE = 0.72
const BRAKE_GRIP_SHARE = 0.65
/** In the rain the guide is more cautious (rain is visual only for the physics today). */
const WET_GRIP = 0.9
/** Straight-line cap, m/s: past this a point is never a "corner". */
const STRAIGHT_CAP = 88
/** "Corners only" shows points whose target is below this, m/s (~200 km/h), braking zones included. */
export const CORNER_SPEED = 55
/** Lift when faster than this share of what the brakes could still shed in time. */
const LIFT_AT = 0.7
const BRAKE_AT = 0.9

export class BrakingGuide {
  readonly speeds: Float64Array
  /** Metres from point 0 along the centreline. */
  readonly distances: Float64Array
  readonly length: number
  /** Planned braking deceleration, m/s². */
  readonly braking: number
  private readonly n: number

  constructor(line: readonly Point3[], car: GuideCar, wet = false) {
    const n = (this.n = line.length)
    if (n < 3) throw new Error('BrakingGuide needs a closed line with at least three points')
    this.distances = new Float64Array(n + 1)
    for (let i = 0; i < n; i++) {
      const a = line[i], b = line[(i + 1) % n]
      this.distances[i + 1] = this.distances[i] + Math.hypot(b.x - a.x, b.z - a.z)
    }
    this.length = this.distances[n]
    const grip = car.grip * (wet ? WET_GRIP : 1)
    const downforce = car.downforcePerKg / 9.81
    this.braking = Math.min(BRAKE_GRIP_SHARE * grip * 9.81, car.brakeDecel)
    const lateral = CORNER_GRIP_SHARE * grip * 9.81
    this.speeds = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = line[(i - 2 + n) % n], b = line[i], c = line[(i + 2) % n]
      const ab = Math.hypot(b.x - a.x, b.z - a.z), bc = Math.hypot(c.x - b.x, c.z - b.z), ac = Math.hypot(c.x - a.x, c.z - a.z)
      const curvature = (2 * Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x))) / Math.max(0.001, ab * bc * ac)
      const room = Math.max(curvature, 0.001) - lateral * downforce
      this.speeds[i] = Math.min(room > 0 ? Math.sqrt(lateral / room) : Infinity, STRAIGHT_CAP)
    }
    // Two backward passes carry each braking zone across the start line.
    for (let k = n * 2 - 1; k >= 0; k--) {
      const i = k % n, next = (i + 1) % n
      const ds = this.distances[i + 1] - this.distances[i]
      this.speeds[i] = Math.min(this.speeds[i], Math.sqrt(this.speeds[next] ** 2 + 2 * this.braking * ds))
    }
  }

  /** Metres from point `from` forward to point `to`, around the loop. */
  ahead(from: number, to: number): number {
    const d = this.distances[to % this.n] - this.distances[from % this.n]
    return d >= 0 ? d : d + this.length
  }

  /**
   * At `speed` m/s now, `metres` before point `i`: accelerate, lift or brake.
   * Compares the deceleration needed to reach the point's target with what the
   * plan allows.
   */
  cue(i: number, speed: number, metres: number): GuideCue {
    const target = this.speeds[i % this.n]
    if (speed <= target) return GO
    const needed = (speed * speed - target * target) / (2 * Math.max(metres, 1))
    if (needed >= BRAKE_AT * this.braking) return BRAKE
    if (needed >= LIFT_AT * this.braking) return LIFT
    return GO
  }

  /** In a corner or the braking zone before one ("Corners only" mode). */
  isCorner(i: number): boolean {
    return this.speeds[i % this.n] < CORNER_SPEED
  }
}
