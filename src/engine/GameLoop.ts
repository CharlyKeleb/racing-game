/**
 * Fixed-timestep loop ("Fix Your Timestep"). Physics and gameplay always tick
 * at FIXED_DT so handling is identical at 30, 60 or 144 Hz; rendering runs once
 * per animation frame with an interpolation alpha between the last two ticks.
 */

export const FIXED_DT = 1 / 60
/** Cap catch-up work after a tab switch or long GC pause (spiral-of-death guard). */
const MAX_FRAME_TIME = 0.25

export interface LoopCallbacks {
  fixedUpdate(dt: number): void
  /** alpha ∈ [0,1): how far we are between the previous and current tick. */
  render(alpha: number, frameDt: number): void
}

export class GameLoop {
  private accumulator = 0
  private lastTime = 0
  private rafId = 0
  private running = false
  private readonly callbacks: LoopCallbacks

  constructor(callbacks: LoopCallbacks) {
    this.callbacks = callbacks
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  /** Advances the simulation; exposed separately so tests can drive it. */
  advance(frameTime: number): number {
    const clamped = Math.min(frameTime, MAX_FRAME_TIME)
    this.accumulator += clamped
    let steps = 0
    while (this.accumulator >= FIXED_DT) {
      this.callbacks.fixedUpdate(FIXED_DT)
      this.accumulator -= FIXED_DT
      steps++
    }
    this.callbacks.render(this.accumulator / FIXED_DT, clamped)
    return steps
  }

  private frame = (now: number): void => {
    if (!this.running) return
    const frameTime = (now - this.lastTime) / 1000
    this.lastTime = now
    this.advance(frameTime)
    this.rafId = requestAnimationFrame(this.frame)
  }
}
