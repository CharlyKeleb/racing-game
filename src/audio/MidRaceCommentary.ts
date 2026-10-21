import type { NarrationId } from './narration'

interface Sample {
  mode: 'quick' | 'drift' | 'timeTrial' | 'freeRoam'
  timeMs: number
  speedKmh: number
  driftScoring: boolean
  lap: number
  totalLaps: number
}

/** Fill genuinely quiet racing stretches without inventing passes or race outcomes. */
export class MidRaceCommentary {
  private nextCoachingAt = 14000
  private alternate = false
  private finalLapDone = false
  reset(): void { this.nextCoachingAt = 14000; this.alternate = false; this.finalLapDone = false }

  update(sample: Sample, quietMs: number): NarrationId | null {
    const { mode, timeMs, speedKmh, driftScoring, lap, totalLaps } = sample
    if (mode !== 'quick' && mode !== 'freeRoam' && Number.isFinite(totalLaps) && totalLaps > 1 && lap === totalLaps && !this.finalLapDone) {
      this.finalLapDone = true
      return 'finalLap'
    }
    if (mode === 'freeRoam' || timeMs < this.nextCoachingAt || quietMs < 12000 || speedKmh < 25) return null
    this.nextCoachingAt = timeMs + 22000
    if (mode === 'drift') return driftScoring ? 'driftFlow' : 'driftSetup'
    this.alternate = !this.alternate
    return this.alternate ? 'focus' : 'rhythm'
  }
}
