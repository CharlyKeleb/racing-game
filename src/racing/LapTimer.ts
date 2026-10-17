/** Pure lap timing, driven by fixed-tick dt (not wall clock) so pauses are free. */
export class LapTimer {
  currentLapMs = 0
  totalMs = 0
  lastLapMs: number | null = null
  bestLapMs: number | null = null
  readonly laps: number[] = []
  running = false

  tick(dt: number): void {
    if (!this.running) return
    const ms = dt * 1000
    this.currentLapMs += ms
    this.totalMs += ms
  }

  /** Closes the current lap; returns true if it was a personal best. */
  completeLap(): boolean {
    const lap = this.currentLapMs
    this.laps.push(lap)
    this.lastLapMs = lap
    this.currentLapMs = 0
    const best = this.bestLapMs === null || lap < this.bestLapMs
    if (best) this.bestLapMs = lap
    return best
  }

  reset(): void {
    this.currentLapMs = 0
    this.totalMs = 0
    this.lastLapMs = null
    this.laps.length = 0
    this.running = false
    // bestLapMs survives restarts within a session on purpose.
  }
}

export function formatTime(ms: number | null): string {
  if (ms === null) return '--:--.---'
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const r = Math.floor(ms % 1000)
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`
}
