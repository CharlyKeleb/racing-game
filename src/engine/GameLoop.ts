import { performanceCapture } from './PerformanceCapture'

/**
 * Fixed-timestep loop ("Fix Your Timestep"). Physics and gameplay always tick
 * at FIXED_DT so handling is identical at 30, 60 or 144 Hz; rendering runs once
 * per animation frame with an interpolation alpha between the last two ticks.
 */

export const FIXED_DT = 1 / 60
/** Cap catch-up work after a tab switch or long GC pause (spiral-of-death guard). */
const MAX_FRAME_TIME = 0.25
/** Spread stall recovery across frames without changing the 60 Hz simulation step. */
const MAX_STEPS_PER_FRAME = 5

export interface LoopCallbacks {
  fixedUpdate(dt: number): void
  /** alpha ∈ [0,1]: how far we are between the previous and current tick. */
  render(alpha: number, frameDt: number): void
}

export class GameLoop {
  /** Presentation slow motion; physics still steps at exactly FIXED_DT. */
  timeScale = 1
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
    this.accumulator = 0
    this.lastTime = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
  }

  stop(): void {
    this.running = false
    cancelAnimationFrame(this.rafId)
  }

  /** Advances the simulation; exposed separately so tests can drive it. */
  advance(frameTime: number): number {
    const profiling = performanceCapture.active
    const started = profiling ? performance.now() : 0
    const clamped = Number.isFinite(frameTime) ? Math.max(0, Math.min(frameTime, MAX_FRAME_TIME)) : 0
    const scale = Number.isFinite(this.timeScale) ? Math.max(0, Math.min(1, this.timeScale)) : 1
    this.accumulator += clamped * scale
    let steps = 0
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.callbacks.fixedUpdate(FIXED_DT)
      this.accumulator -= FIXED_DT
      steps++
    }
    const simulated = profiling ? performance.now() : 0
    // Pending ticks remain queued: catch-up never silently advances race timers.
    // Render the latest state while behind instead of extrapolating it.
    this.callbacks.render(Math.min(this.accumulator / FIXED_DT, 1), clamped)
    if (profiling && this.accumulator >= FIXED_DT) performanceCapture.event('simulation-backlog', 0, { pendingMs: this.accumulator * 1000 })
    if (profiling) performanceCapture.frame(frameTime * 1000, steps, simulated - started, performance.now() - simulated)
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
