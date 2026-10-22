import type { QualityPreset } from '../stores/gameStore'

/** Frame pacing controller; all time is visible, active frame time in seconds. */
export class AdaptiveResolution {
  readonly max: number
  readonly min: number
  ratio: number
  private elapsed = 0
  private frames = 0
  private sinceResize = 0
  private badWindows = 0
  private goodWindows = 0

  constructor(quality: QualityPreset, dpr: number) {
    const display = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
    this.max = Math.min(display, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1)
    this.min = Math.min(this.max, quality === 'low' ? .55 : .75)
    // Start near the measured sustainable range, rather than paying for DPR 2
    // until several poor one-second windows have passed. Quality remains user-selected.
    this.ratio = Math.min(this.max, quality === 'low' ? .8 : 1)
  }

  resetWindow(): void {
    this.elapsed = 0
    this.frames = 0
    this.badWindows = 0
    this.goodWindows = 0
  }

  update(dt: number): boolean {
    if (!Number.isFinite(dt) || dt <= 0 || dt > .2) {
      this.resetWindow()
      return false
    }
    this.elapsed += dt
    this.sinceResize += dt
    this.frames++
    if (this.elapsed < 1) return false
    const fps = this.frames / this.elapsed
    this.elapsed = 0
    this.frames = 0
    this.badWindows = fps < 55 ? this.badWindows + 1 : 0
    this.goodWindows = fps > 58 ? this.goodWindows + 1 : 0
    let next = this.ratio
    if (this.badWindows >= 2 && this.sinceResize >= 3) next = Math.max(this.min, this.ratio - .15)
    else if (this.goodWindows >= 8 && this.sinceResize >= 8) next = Math.min(this.max, this.ratio + .1)
    next = Math.min(this.max, Math.max(this.min, Math.round(next * 1000) / 1000))
    if (next === this.ratio) return false
    this.ratio = next
    this.sinceResize = 0
    this.badWindows = 0
    this.goodWindows = 0
    return true
  }
}
