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
/**
 * Most simulation time ever owed. Below ~12 fps the 5-step cap can't keep up; an unbounded backlog
 * grew ~10 s per minute and, once the frame rate recovered, fast-forwarded at 5x (cars launched).
 * Past this the game runs in slow motion instead, which is what a slow machine should look like.
 */
const MAX_BACKLOG = MAX_FRAME_TIME

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
  private failed = false
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
    this.accumulator = Math.min(MAX_BACKLOG, this.accumulator + clamped * scale)
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
    // Scheduled first: one throwing frame (a driver-specific render error) used to end the loop for
    // good, freezing the last half-drawn frame and the car while the React HUD kept running.
    this.rafId = requestAnimationFrame(this.frame)
    const frameTime = (now - this.lastTime) / 1000
    this.lastTime = now
    try {
      this.advance(frameTime)
    } catch (error) {
      if (!this.failed) console.error('Game frame failed; the loop keeps running', error)
      this.failed = true
    }
  }
}
