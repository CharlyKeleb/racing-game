export const FINISH_SECONDS = 4.2
const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }
/** Presentation clock in real seconds; race clocks remain fixed-step simulation time. */
export class FinishSequence {
  elapsed = 0
  reducedMotion = false
  started = false
  private get duration(): number { return this.reducedMotion ? 1.1 : FINISH_SECONDS }
  get progress(): number { return this.started ? Math.min(1, this.elapsed / this.duration) : 0 }
  get active(): boolean { return this.started && this.progress < 1 }
  get timeScale(): number {
    if (!this.active || this.reducedMotion) return 1
    if (this.elapsed < .4) return 1 - .72 * smooth(this.elapsed / .4)
    return .28 + .72 * smooth((this.elapsed - .85) / (FINISH_SECONDS - .85))
  }
  start(reducedMotion = false): void { this.elapsed = 0; this.reducedMotion = reducedMotion; this.started = true }
  update(dt: number): void { if (this.active && Number.isFinite(dt)) this.elapsed = Math.min(this.duration, this.elapsed + Math.max(0, dt)) }
  skip(): void { if (this.started) this.elapsed = this.duration }
  reset(): void { this.elapsed = 0; this.started = false }
}
