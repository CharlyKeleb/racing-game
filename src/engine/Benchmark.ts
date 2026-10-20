import type * as THREE from 'three'
import type { InputState } from '../input/InputManager'
import { summarize } from './PerformanceCapture'

/** Seconds of driving before measuring (shader compiles, streaming catches up), then measured. */
const WARMUP_S = 8
const MEASURE_S = 60
/** Room for 60 s at up to 240 Hz. */
const MAX_FRAMES = MEASURE_S * 240

/** What the benchmark needs from the game; Game supplies it (see Game.startBenchmark). */
export interface BenchmarkHost {
  racing(): boolean
  position(): THREE.Vector3
  quaternion(): THREE.Quaternion
  speedKmh(): number
  /** Centreline point `ahead` points past the car's tracked one. */
  lineAhead(ahead: number): THREE.Vector3
  setInput(state: Partial<InputState>): void
  startRace(): void
  drawCalls(): number
  triangles(): number
  /** Everything a result needs to be comparable: renderer, GPU, settings, display. */
  environment(): Promise<Record<string, unknown>>
}

export interface BenchmarkResult {
  environment: Record<string, unknown>
  seconds: number
  frames: number
  fps: number
  frameMs: ReturnType<typeof summarize>
  drawCalls: number
  triangles: number
}

/**
 * `?bench=1`: a repeatable WebGL vs WebGPU comparison (#50) on real
 * hardware. Starts a race with the saved settings, drives it on autopilot
 * (centreline follower, full throttle with braking for bends), warms up for
 * 8 s, then records 60 s of frame intervals and render counts, and shows the
 * summary with renderer, GPU and settings to copy into the issue. Run it once
 * per renderer (Settings → Renderer), same track and preset.
 */
export class Benchmark {
  private readonly host: BenchmarkHost
  private readonly frames = new Float32Array(MAX_FRAMES)
  private count = 0
  private elapsed = 0
  private last = 0
  private calls = 0
  private triangles = 0
  private state: 'waiting' | 'warmup' | 'measuring' | 'done' = 'waiting'
  private started = false
  private readonly panel: HTMLElement

  constructor(host: BenchmarkHost) {
    this.host = host
    this.panel = document.createElement('pre')
    this.panel.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:10000;margin:0;padding:8px 12px;background:#000c;color:#fff;font:12px/1.4 monospace;white-space:pre-wrap;max-width:min(560px,92vw);pointer-events:auto'
    this.panel.textContent = 'Benchmark: waiting for the game to load…'
    document.body.append(this.panel)
  }

  /** Call once the menu is up: starts the race. */
  start(): void {
    if (this.started) return
    this.started = true
    this.host.startRace()
    this.panel.textContent = 'Benchmark: race starting…'
  }

  /** Every rendered frame. */
  frame(): void {
    if (this.state === 'done' || !this.started) return
    const now = performance.now()
    const dt = this.last ? (now - this.last) / 1000 : 0
    this.last = now
    if (!this.host.racing()) return
    this.drive()
    if (this.state === 'waiting') this.state = 'warmup'
    this.elapsed += dt
    if (this.state === 'warmup') {
      if (this.elapsed < WARMUP_S) return
      this.state = 'measuring'
      this.elapsed = 0
      this.panel.textContent = `Benchmark: measuring ${MEASURE_S} s…`
      return
    }
    if (this.count < MAX_FRAMES) this.frames[this.count++] = dt * 1000
    this.calls += this.host.drawCalls()
    this.triangles += this.host.triangles()
    if (this.elapsed >= MEASURE_S) void this.finish()
  }

  /** Centreline follower: steer at a point ~30 m ahead, brake for sharp bends. */
  private drive(): void {
    const h = this.host
    const target = h.lineAhead(8)
    const q = h.quaternion(), p = h.position(), kmh = h.speedKmh()
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y)
    const dx = target.x - p.x, dz = target.z - p.z
    const angle = Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz)
    const aim = Math.abs(angle) > 0.25 ? 80 : 170
    h.setInput({
      steer: Math.max(-1, Math.min(1, -angle * 2.5)),
      throttle: kmh < aim ? 1 : 0,
      brake: kmh > aim + 25 ? 1 : 0,
      handbrake: false,
      nitro: false,
    })
  }

  private async finish(): Promise<void> {
    this.state = 'done'
    this.host.setInput({ steer: 0, throttle: 0, brake: 0 })
    const frames = Array.from(this.frames.subarray(0, this.count))
    const seconds = frames.reduce((a, b) => a + b, 0) / 1000
    const result: BenchmarkResult = {
      environment: await this.host.environment(),
      seconds: Math.round(seconds * 10) / 10,
      frames: this.count,
      fps: Math.round((this.count / seconds) * 10) / 10,
      frameMs: summarize(frames),
      drawCalls: Math.round(this.calls / Math.max(1, this.count)),
      triangles: Math.round(this.triangles / Math.max(1, this.count)),
    }
    ;(window as unknown as { __raceBench?: BenchmarkResult }).__raceBench = result
    const json = JSON.stringify(result, null, 2)
    this.panel.textContent = `Benchmark done: ${result.fps} fps, p95 ${result.frameMs.p95?.toFixed(1)} ms (${String(result.environment.backend)})\n\n${json}\n\n`
    const copy = document.createElement('button')
    copy.textContent = 'Copy result'
    copy.style.cssText = 'padding:6px 10px;color:#fff;background:#333;border:1px solid #666;cursor:pointer'
    copy.onclick = () => void navigator.clipboard?.writeText(json).then(() => { copy.textContent = 'Copied' })
    this.panel.append(copy)
  }
}
