/**
 * Decides when a car needs putting back on the track: fallen off the world,
 * on its roof, or wedged and unable to move while its driver is trying to.
 * Pure (numbers in, a verdict out) so it can run on a server later.
 */

/** Metres below the nearest centreline point that count as off the world. */
export const FALL_DROP = 8
/** Up-vector Y below this is on its side or roof. */
const FLIPPED_UP = 0.35
const FLIPPED_SEC = 1.5
/** Slower than this (m/s) with a pedal pressed counts as wedged. */
const STUCK_SPEED = 1.2
const STUCK_PEDAL = 0.3
const STUCK_SEC = 3.5
/** Further than this from the centreline counts as lost (run-off is narrower almost everywhere). */
const LOST_METRES = 70
const LOST_SEC = 3

export interface RecoverySample {
  /** Car height minus the nearest centreline point's height, m. */
  drop: number
  /** World-up component of the car's up axis, -1..1. */
  upY: number
  /** |forward speed|, m/s. */
  speed: number
  /** Largest of throttle and brake, 0..1. */
  pedal: number
  /** Horizontal metres to the nearest centreline point. */
  offLine: number
}

export type RecoveryReason = 'fell' | 'flipped' | 'stuck' | 'lost'

export class RecoveryMonitor {
  private flipped = 0
  private stuck = 0
  private lost = 0

  /** @returns why the car needs recovering, or null while it's fine. */
  update(dt: number, s: RecoverySample): RecoveryReason | null {
    this.flipped = s.upY < FLIPPED_UP ? this.flipped + dt : 0
    this.stuck = s.speed < STUCK_SPEED && s.pedal > STUCK_PEDAL ? this.stuck + dt : 0
    this.lost = s.offLine > LOST_METRES ? this.lost + dt : 0
    if (s.drop < -FALL_DROP) return 'fell'
    if (this.flipped > FLIPPED_SEC) return 'flipped'
    if (this.stuck > STUCK_SEC) return 'stuck'
    if (this.lost > LOST_SEC) return 'lost'
    return null
  }

  reset(): void {
    this.flipped = this.stuck = this.lost = 0
  }
}
