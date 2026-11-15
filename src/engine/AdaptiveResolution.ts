import type { QualityPreset } from '../stores/gameStore'

/**
 * Ultra's MSAA samples. 4× where the display's pixels are big enough to show
 * stair-steps (DPR < 1.5: 1080p and 1440p monitors). On a Retina or 4K screen
 * Ultra already renders at DPR ≥ 2, where 4× MSAA doubled the frame time
 * (17 → 33 ms at 3840×2160) for little gain over SMAA.
 */
export function msaaSamples(quality: QualityPreset, dpr: number): number {
  return quality === 'ultra' && !(dpr >= 1.5) ? 4 : 0
}

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

  /**
   * `showroom`: the garage, one car in a baked room, where the car is looked at
   * up close: Medium and High go up to the display's full sharpness (≤ 2) and
   * start at 1.5, still dropping if the frame rate can't hold.
   *
   * Ultra renders at the display's native resolution (≤ 3, so 3840×2160 on a
   * 4K screen at DPR 2) and starts there. It still steps down if the frame
   * rate can't hold, but never below one pixel per CSS pixel.
   */
  constructor(quality: QualityPreset, dpr: number, showroom = false) {
    const display = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
    const cap = quality === 'low' ? 1 : quality === 'ultra' ? 3 : showroom || quality === 'high' ? 2 : 1.5
    this.max = Math.min(display, cap)
    this.min = Math.min(this.max, quality === 'low' ? .55 : quality === 'ultra' ? 1 : .75)
    // Start near the measured sustainable range, rather than paying for DPR 2
    // until several poor one-second windows have passed. Quality remains user-selected.
    this.ratio = Math.min(this.max, quality === 'low' ? .8 : quality === 'ultra' ? this.max : showroom ? 1.5 : 1)
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
