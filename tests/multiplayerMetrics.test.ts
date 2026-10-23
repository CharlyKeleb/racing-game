import { expect, it, vi } from 'vitest'
import { MultiplayerMetrics, consoleMetrics, type MetricGauges } from '../server/src/MultiplayerMetrics'
const gauges: MetricGauges = { rooms: 1, racers: 2, heldSeats: 0, activeRaces: 1, admissionClaims: 0, pendingResultWrites: 0, rssMiB: 100, heapUsedMiB: 20 }
it('keeps fixed histogram storage and reports conservative quantiles without invalid numbers', () => {
  const metrics = new MultiplayerMetrics()
  for (let i = 0; i < 100_000; i++) { metrics.advanced(16.67, .5); metrics.count('input_accepted') }
  metrics.advanced(NaN, -1); metrics.sampledSnapshot(1500, 6); metrics.finalized(120_000)
  const report = metrics.snapshot(gauges)
  expect(report.events.input_accepted).toBe(100_000)
  expect(report.histograms.advance_ms).toMatchObject({ count: 100_000, mean: .5, max: .5, p95Upper: .5 })
  expect(report.histograms.advance_ms.buckets.length).toBe(report.histograms.advance_ms.bounds.length + 1)
  expect(report.histograms.finalize_ms).toMatchObject({ count: 1, max: 120_000, p95Upper: null })
  expect(report.histograms.snapshot_bytes).toMatchObject({ count: 1, p95Upper: 2048 })
  expect(report.histograms.input_age_ticks).toMatchObject({ count: 1, p95Upper: 6 })
  report.events.input_accepted = 0; report.histograms.advance_ms.buckets.fill(0); report.gauges.rooms = 100
  expect(metrics.snapshot(gauges).events.input_accepted).toBe(100_000)
  expect(metrics.snapshot(gauges).histograms.advance_ms.buckets.reduce((a,b)=>a+b,0)).toBe(100_000)
  expect(gauges.rooms).toBe(1)
})
it('requires explicit metrics opt-in and does not echo invalid environment values', () => {
  expect(consoleMetrics(undefined)).toBeUndefined(); expect(consoleMetrics('0')).toBeUndefined()
  expect(() => consoleMetrics('private-unexpected-value')).toThrow('MULTIPLAYER_METRICS must be 0 or 1')
  const log = vi.spyOn(console,'info').mockImplementation(()=>{})
  try {
    consoleMetrics('1')!.report(new MultiplayerMetrics().snapshot(gauges))
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toBe('Multiplayer metrics')
    expect(JSON.parse(log.mock.calls[0][1]).schema).toBe(1)
  } finally { log.mockRestore() }
})
