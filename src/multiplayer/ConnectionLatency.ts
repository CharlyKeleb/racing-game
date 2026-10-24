export interface ConnectionLatencySample {
  rttMs: number
  /** Range of the last eight measured RTTs, not statistical network jitter. */
  variationMs: number
  samples: number
}
const MAX_AGE_MS = 5000
/** One outstanding echo and eight samples per connection. No client/server clock synchronization. */
export class ConnectionLatency {
  private sequence = 0
  private pending: { sequence: number; at: number } | null = null
  private readonly values = new Float64Array(8)
  private count = 0
  private index = 0
  private lastAt = -Infinity
  private latest = 0
  next(now: number): number | null {
    if (this.pending && now - this.pending.at < MAX_AGE_MS) return null
    if (now - this.lastAt >= MAX_AGE_MS) { this.count = 0; this.index = 0 }
    const sequence = this.sequence++
    this.pending = { sequence, at: now }
    return sequence
  }
  accept(sequence: unknown, now: number): boolean {
    if (!this.pending || sequence !== this.pending.sequence) return false
    const elapsed = now - this.pending.at
    this.pending = null
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= MAX_AGE_MS) return false
    if (now - this.lastAt >= MAX_AGE_MS) { this.count = 0; this.index = 0 }
    this.values[this.index] = elapsed; this.index = (this.index + 1) % 8
    this.count = Math.min(this.count + 1, 8); this.lastAt = now; this.latest = elapsed
    return true
  }
  read(now: number): ConnectionLatencySample | null {
    if (!this.count || now - this.lastAt >= MAX_AGE_MS || now < this.lastAt) return null
    let min = Infinity, max = -Infinity
    for (let i = 0; i < this.count; i++) { min = Math.min(min, this.values[i]); max = Math.max(max, this.values[i]) }
    return { rttMs: Math.round(this.latest), variationMs: Math.round(max - min), samples: this.count }
  }
}
