import type * as THREE from 'three'
import type { Checkpoint } from '../world/Track'
import { CheckpointManager } from './CheckpointManager'
import { LapTimer } from './LapTimer'

export type RaceState = 'idle' | 'intro' | 'countdown' | 'racing' | 'finished'

export interface RaceEvents {
  onStateChange(state: RaceState): void
  onLap(lap: number, timeMs: number, best: boolean): void
}

export const COUNTDOWN_SEC = 3
/** Red lights on the start gantry; they come on one by one through the countdown and all go out at the start. */
export const START_LIGHTS = 5
const FIRST_LIGHT_SEC = 0.25
const LIGHT_INTERVAL_SEC = 0.55

/** How many start lights are lit with `countdown` seconds still to go. */
export function startLightsLit(countdown: number): number {
  if (countdown <= 0) return 0
  const elapsed = COUNTDOWN_SEC - countdown
  return Math.max(0, Math.min(START_LIGHTS, Math.floor((elapsed - FIRST_LIGHT_SEC) / LIGHT_INTERVAL_SEC) + 1))
}

/** Race rules: countdown → N laps → finished. Knows nothing about rendering. */
export class RaceManager {
  state: RaceState = 'idle'
  /** 1-based current lap while racing. */
  lap = 0
  countdown = 0
  introRemaining = 0
  introDuration = 0
  totalLaps: number
  readonly timer = new LapTimer()
  private readonly checkpoints: CheckpointManager
  private readonly events: RaceEvents

  constructor(checkpoints: Checkpoint[], totalLaps: number, events: RaceEvents) {
    this.checkpoints = new CheckpointManager(checkpoints)
    this.totalLaps = totalLaps
    this.events = events
  }

  /** Last checkpoint passed this lap, for resets. */
  get lastCheckpoint(): number {
    return this.checkpoints.last
  }

  /** Vehicle controls are locked until this is true. */
  get controlsEnabled(): boolean {
    return this.state === 'racing' || this.state === 'finished'
  }

  start(totalLaps: number, introSeconds = 0): void {
    this.totalLaps = totalLaps
    this.timer.reset()
    this.checkpoints.reset()
    this.lap = 0
    this.countdown = COUNTDOWN_SEC
    this.introRemaining = this.introDuration = Math.max(0,introSeconds)
    this.setState(this.introRemaining > 0 ? 'intro' : 'countdown')
  }

  skipIntro(): void {
    if (this.state !== 'intro') return
    this.introRemaining = 0
    this.setState('countdown')
  }

  update(dt: number, carPosition: THREE.Vector3): void {
    if (this.state === 'intro') {
      this.introRemaining = Math.max(0,this.introRemaining-dt)
      if (this.introRemaining < 0.000001) this.skipIntro()
      return
    }
    if (this.state === 'countdown') {
      this.countdown -= dt
      if (this.countdown <= 0) {
        this.countdown = 0
        this.lap = 1
        this.timer.running = true
        this.setState('racing')
      }
      return
    }
    if (this.state !== 'racing') return

    this.timer.tick(dt)
    if (this.checkpoints.update(carPosition) === 'lap') {
      const best = this.timer.completeLap()
      this.events.onLap(this.lap, this.timer.lastLapMs!, best)
      if (this.lap >= this.totalLaps) {
        this.timer.running = false
        this.setState('finished')
      } else {
        this.lap++
      }
    }
  }

  private setState(state: RaceState): void {
    this.state = state
    this.events.onStateChange(state)
  }
}
