/** Fixed numeric fields only. No player/session/room/token values become labels. */
const EVENTS = ['admission_ok', 'admission_rejected', 'admission_rate_limited', 'input_accepted', 'input_rejected',
  'reconnect_started', 'reconnect_succeeded', 'reconnect_failed', 'race_started', 'race_finished', 'race_aborted',
  'result_pending', 'result_saved', 'result_failed'] as const
export type MetricEvent = typeof EVENTS[number]
const TIME_BUCKETS = [.125, .25, .5, 1, 2, 4, 8, 12, 16, 16.67, 20, 25, 33.34, 50, 100, 250, 500, 1000]
class Histogram {
  private readonly bounds: readonly number[]
  private readonly buckets: Float64Array
  private count = 0
  private sum = 0
  private max = 0
  constructor(bounds: readonly number[]) { this.bounds = bounds; this.buckets = new Float64Array(bounds.length + 1) }
  observe(value: number): void {
    if (!Number.isFinite(value) || value < 0) return
    let i = 0
    while (i < this.bounds.length && value > this.bounds[i]) i++
    this.buckets[i]++
    this.count++; this.sum += value; this.max = Math.max(this.max, value)
  }
  snapshot() {
    let total = 0, p95Upper: number | null = null
    if (this.count) for (let i = 0; i < this.buckets.length; i++) {
      total += this.buckets[i]
      if (total >= Math.ceil(this.count * .95)) { p95Upper = this.bounds[i] ?? null; break }
    }
    return { count: this.count, mean: this.count ? this.sum / this.count : null, max: this.count ? this.max : null,
      p95Upper, bounds: [...this.bounds], buckets: Array.from(this.buckets) }
  }
}
export interface MetricGauges {
  rooms: number
  racers: number
  heldSeats: number
  activeRaces: number
  admissionClaims: number
  pendingResultWrites: number
  rssMiB: number
  heapUsedMiB: number
}
export interface MetricsReport {
  schema: 1
  uptimeSeconds: number
  events: Record<MetricEvent, number>
  gauges: MetricGauges
  histograms: {
    advance_ms: ReturnType<Histogram['snapshot']>
    callback_gap_ms: ReturnType<Histogram['snapshot']>
    input_age_ticks: ReturnType<Histogram['snapshot']>
    snapshot_bytes: ReturnType<Histogram['snapshot']>
    finalize_ms: ReturnType<Histogram['snapshot']>
  }
}
export interface MetricsOptions { report(value: MetricsReport): void; intervalMs?: number }

/** Constant storage; observations allocate nothing. Reports are lifetime aggregates. */
export class MultiplayerMetrics {
  private readonly started = performance.now()
  private readonly events = Object.fromEntries(EVENTS.map(event => [event, 0])) as Record<MetricEvent, number>
  private readonly advance = new Histogram(TIME_BUCKETS)
  private readonly gaps = new Histogram(TIME_BUCKETS)
  private readonly inputAge = new Histogram([0, 1, 2, 3, 6, 15, 30, 60, 120, 600, 36000])
  private readonly bytes = new Histogram([256, 512, 1024, 2048, 4096, 8192, 16384, 32768])
  private readonly finalize = new Histogram([1, 10, 100, 1000, 5000, 10000, 30000, 60000])
  count(event: MetricEvent): void { this.events[event]++ }
  advanced(deltaMs: number, workMs: number): void { this.gaps.observe(deltaMs); this.advance.observe(workMs) }
  sampledSnapshot(bytes: number, inputAge: number | null): void {
    this.bytes.observe(bytes)
    if (inputAge !== null) this.inputAge.observe(inputAge)
  }
  finalized(ms: number): void { this.finalize.observe(ms) }
  snapshot(gauges: MetricGauges): MetricsReport {
    return { schema: 1, uptimeSeconds: Math.max(0, (performance.now() - this.started) / 1000), events: { ...this.events }, gauges: { ...gauges },
      histograms: { advance_ms: this.advance.snapshot(), callback_gap_ms: this.gaps.snapshot(), input_age_ticks: this.inputAge.snapshot(),
        snapshot_bytes: this.bytes.snapshot(), finalize_ms: this.finalize.snapshot() } }
  }
}
/** Explicit opt-in. Reporter receives only the numeric schema above. */
export function consoleMetrics(value: string | undefined): MetricsOptions | undefined {
  if (value === undefined || value === '0') return undefined
  if (value !== '1') throw new Error('MULTIPLAYER_METRICS must be 0 or 1')
  return { report: report => console.info('Multiplayer metrics', JSON.stringify(report)) }
}
