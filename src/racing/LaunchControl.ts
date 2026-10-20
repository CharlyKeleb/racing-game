/**
 * Skill launch at lights-out (#91). On the grid the driver holds the launch
 * (handbrake or brake), keeps the revs in a band with the throttle, and lets go
 * when the lights go out. Pure and fixed-step: numbers in, numbers out, so the
 * grade depends on ticks, never on the render frame rate.
 *
 * The reward is a short, capped push along the car (see `force`), not nitro.
 * A sloppy launch is a normal start or a slight bog, never a stall.
 */

export interface LaunchConfig {
  /** Target rev band, as a share of the idle→redline range. */
  bandLow: number
  bandHigh: number
  /** Revs this far outside the band still count as a good launch. */
  bandSlack: number
  /** The revs must have sat in the band this long, seconds, by lights-out. */
  bandHoldSec: number
  /** Release within this long of lights-out for a perfect launch, seconds… */
  perfectReactionSec: number
  /** …or this long for a good one. Later than this is a poor launch. */
  goodReactionSec: number
  /** Extra push along the car, m/s² (× mass = N), so the gain is the same for heavy and light cars. */
  perfectAccel: number
  goodAccel: number
  /** A poor launch bogs: negative push, m/s². Small on purpose. */
  poorAccel: number
  /** How long the push lasts, seconds; it fades out over the last half. */
  durationSec: number
}

export const DEFAULT_LAUNCH: LaunchConfig = {
  bandLow: 0.6,
  bandHigh: 0.84,
  bandSlack: 0.08,
  bandHoldSec: 0.3,
  perfectReactionSec: 0.2,
  goodReactionSec: 0.4,
  perfectAccel: 2.4,
  goodAccel: 1.2,
  poorAccel: -0.8,
  durationSec: 1.2,
}

export type LaunchGrade = 'none' | 'perfect' | 'good' | 'poor' | 'early'
export type LaunchPhase = 'staging' | 'go' | 'other'

export interface LaunchInput {
  /** 'staging' while the lights count down, 'go' once they're out, 'other' before (intro). */
  phase: LaunchPhase
  /** Staging revs as a share of the idle→redline range, 0..1. */
  revs: number
  /** Throttle pedal, 0..1. */
  throttle: number
  /** Launch held: handbrake, or brake pressed hard. */
  hold: boolean
  /** Launch assist: grades a good launch from the throttle alone. */
  assist: boolean
}

/** Stays this long after lights-out waiting for the release; after that it's a poor launch. */
const RELEASE_TIMEOUT_SEC = 1

export class LaunchControl {
  grade: LaunchGrade = 'none'
  /** Lights-out → release, seconds (−1 until graded on a release). */
  reaction = -1
  /** Revs share sampled on the lights-out tick. */
  revsAtGo = 0
  /** Holding the launch on the grid, from a fresh press made since this start began. */
  armed = false
  /** Seconds the revs have sat in the band without a break. */
  bandTime = 0
  /** Seconds since the grade was given (for the HUD flash); Infinity before. */
  sinceGrade = Infinity
  private cfg: LaunchConfig
  /** The hold was seen released since this start began: only then can a press arm. */
  private holdReleased = false
  private bandAtGo = false
  private nearAtGo = false
  private sinceGo = -1
  private done = false
  private pushTime = 0
  private accel = 0

  constructor(cfg: LaunchConfig = DEFAULT_LAUNCH) {
    this.cfg = cfg
  }

  setConfig(cfg: LaunchConfig): void {
    this.cfg = cfg
  }

  /** New start (race start, restart, countdown entry): forget everything. */
  reset(): void {
    this.grade = 'none'
    this.reaction = -1
    this.revsAtGo = 0
    this.armed = false
    this.bandTime = 0
    this.sinceGrade = Infinity
    this.holdReleased = false
    this.bandAtGo = false
    this.nearAtGo = false
    this.sinceGo = -1
    this.done = false
    this.pushTime = 0
    this.accel = 0
  }

  /**
   * Pause or hidden tab. On the grid it disarms (a fresh press is needed after
   * resuming, so a hold left down through the pause can't count). After
   * lights-out it drops this launch for good, so a pause can't buy reaction time.
   */
  interrupt(): void {
    if (this.done) return
    if (this.sinceGo >= 0) {
      this.armed = false
      this.done = true
      return
    }
    this.armed = false
    this.holdReleased = false
    this.bandTime = 0
  }

  /** In the target band right now? */
  inBand(revs: number): boolean {
    return revs >= this.cfg.bandLow && revs <= this.cfg.bandHigh
  }

  /** One fixed tick. */
  update(dt: number, input: LaunchInput): void {
    const cfg = this.cfg
    if (this.sinceGrade !== Infinity) this.sinceGrade += dt
    if (this.pushTime > 0) this.pushTime = Math.max(0, this.pushTime - dt)
    if (this.done) return
    if (input.phase === 'other') {
      // The intro: a press made here counts, a hold carried in from the menu doesn't.
      if (!input.hold) this.holdReleased = true
      return
    }

    if (input.phase === 'staging') {
      this.bandTime = this.inBand(input.revs) ? this.bandTime + dt : 0
      if (!input.hold) {
        // Let go before the lights went out: a jumped launch, just a normal start.
        if (this.armed) this.finish('early', 0)
        else this.holdReleased = true
      } else if (this.holdReleased) {
        this.armed = true
      }
      return
    }

    // Lights out. The first 'go' tick samples the rev state.
    if (this.sinceGo < 0) {
      this.sinceGo = 0
      this.revsAtGo = input.revs
      this.bandAtGo = this.inBand(input.revs) && this.bandTime >= cfg.bandHoldSec
      this.nearAtGo = input.revs >= cfg.bandLow - cfg.bandSlack && input.revs <= cfg.bandHigh + cfg.bandSlack
      if (input.assist) {
        this.finish(input.throttle > 0.5 ? 'good' : 'none', cfg.goodAccel)
        return
      }
      if (!this.armed) {
        this.done = true
        return
      }
    } else {
      this.sinceGo += dt
    }

    if (!input.hold) {
      this.reaction = this.sinceGo
      this.finish(this.gradeRelease(this.sinceGo, input.throttle), 0)
    } else if (this.sinceGo >= RELEASE_TIMEOUT_SEC) {
      this.finish('poor', 0)
    }
  }

  private gradeRelease(reaction: number, throttle: number): LaunchGrade {
    const cfg = this.cfg
    if (throttle < 0.5) return 'poor'
    // Float tolerance: the reaction is a sum of fixed ticks.
    if (this.bandAtGo && reaction <= cfg.perfectReactionSec + 1e-6) return 'perfect'
    if (this.nearAtGo && reaction <= cfg.goodReactionSec + 1e-6) return 'good'
    return 'poor'
  }

  private finish(grade: LaunchGrade, accelOverride: number): void {
    const cfg = this.cfg
    this.grade = grade
    this.armed = false
    this.done = true
    if (grade === 'none') return
    this.sinceGrade = 0
    this.accel = accelOverride || (grade === 'perfect' ? cfg.perfectAccel : grade === 'good' ? cfg.goodAccel : grade === 'poor' ? cfg.poorAccel : 0)
    this.pushTime = this.accel !== 0 ? cfg.durationSec : 0
  }

  /** Push along the car this tick, m/s²: full for the first half, then fading to 0. */
  get push(): number {
    if (this.pushTime <= 0) return 0
    return this.accel * Math.min(1, this.pushTime / (this.cfg.durationSec * 0.5))
  }

  /** Waiting on the release after lights-out (the HUD says "GO"). */
  get waiting(): boolean {
    return this.sinceGo >= 0 && !this.done
  }
}
