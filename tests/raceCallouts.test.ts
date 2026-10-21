import { describe, expect, it } from 'vitest'
import { DISPLAY_MS, RaceCallouts, SUSTAIN_MS, type Callout, type CalloutSample } from '../src/racing/RaceCallouts'

const base: CalloutSample = { timeMs: 0, position: 3, fieldSize: 4, lap: 1, totalLaps: 3, finished: false, finishGapMs: null }

/** Feed samples at 20 Hz from `from` to `to` ms; collect callouts that went on screen. */
function run(c: RaceCallouts, from: number, to: number, patch: (t: number) => Partial<CalloutSample>): Callout[] {
  const shown: Callout[] = []
  for (let t = from; t <= to; t += 50) {
    const out = c.update({ ...base, timeMs: t, ...patch(t) })
    if (out) shown.push(out)
  }
  return shown
}

describe('race callouts (#90)', () => {
  it('calls a sustained overtake once, with the new position', () => {
    const c = new RaceCallouts()
    run(c, 0, 1000, () => ({ position: 3 }))
    const shown = run(c, 1050, 5000, () => ({ position: 2 }))
    expect(shown.map((s) => [s.kind, s.detail])).toEqual([['overtake', 'P2']])
  })

  it('ignores side-by-side flicker that never holds', () => {
    const c = new RaceCallouts()
    const shown = run(c, 0, 10_000, (t) => ({ position: Math.floor(t / 400) % 2 ? 2 : 3 }))
    expect(shown).toEqual([])
  })

  it('distinguishes taking and losing the lead', () => {
    const c = new RaceCallouts()
    run(c, 0, 500, () => ({ position: 2 }))
    const took = run(c, 550, 6000, () => ({ position: 1 }))
    const lost = run(c, 6050, 12_000, () => ({ position: 2 }))
    expect(took.map((s) => s.kind)).toEqual(['lead'])
    expect(lost.map((s) => [s.kind, s.detail])).toEqual([['lostLead', 'P2']])
  })

  it('does not call places lost or regained around a checkpoint reset', () => {
    const c = new RaceCallouts()
    run(c, 0, 1000, () => ({ position: 2 }))
    c.quiet(1000)
    const shown = run(c, 1050, 3500, () => ({ position: 4 }))
    expect(shown).toEqual([])
    // Afterwards, a real overtake from the new baseline still counts.
    expect(run(c, 3550, 8000, () => ({ position: 3 })).map((s) => s.kind)).toEqual(['overtake'])
  })

  it('calls the final lap once, and only in a multi-lap race', () => {
    const c = new RaceCallouts()
    const shown = run(c, 0, 20_000, (t) => ({ lap: t < 5000 ? 2 : 3 }))
    expect(shown.map((s) => s.kind)).toEqual(['finalLap'])
    const single = new RaceCallouts()
    expect(run(single, 0, 5000, () => ({ lap: 1, totalLaps: 1 }))).toEqual([])
  })

  it('calls a photo finish only when it is close, and drops queued overtakes at the line', () => {
    const c = new RaceCallouts()
    run(c, 0, 1000, () => ({ position: 2, lap: 3 }))
    // Pass at 1050 and cross the line before it has been held long enough to call.
    const shown = run(c, 1050, 6000, (t) => ({ position: 1, lap: 3, finished: t >= 1500, finishGapMs: 180 }))
    expect(shown.map((s) => [s.kind, s.detail])).toEqual([['finish', '0.180 s']])
    const clear = new RaceCallouts()
    expect(run(clear, 0, 3000, () => ({ finished: true, finishGapMs: 2400 }))).toEqual([])
  })

  it('a higher-priority callout cuts in, lower ones wait their turn, stale ones are dropped', () => {
    const c = new RaceCallouts()
    run(c, 0, 500, () => ({ position: 3, lap: 2 }))
    // Overtake settles at 1750; the final lap starts at 1800 and outranks it.
    const shown = run(c, 550, 8000, (t) => ({ position: 2, lap: t >= 1800 ? 3 : 2 }))
    expect(shown.map((s) => s.kind)).toEqual(['overtake', 'finalLap'])
    expect(shown[1].at - shown[0].at).toBeLessThan(DISPLAY_MS)
  })

  it('cooldowns stop a run of quick passes from spamming', () => {
    const c = new RaceCallouts()
    run(c, 0, 500, () => ({ position: 4 }))
    // Three passes, each held just long enough, within a few seconds.
    const shown = run(c, 550, 6000, (t) => ({ position: t < 550 + SUSTAIN_MS + 100 ? 3 : t < 550 + 2 * (SUSTAIN_MS + 100) ? 2 : 1 }))
    const kinds = shown.map((s) => s.kind)
    expect(kinds.filter((k) => k === 'overtake').length).toBeLessThanOrEqual(1)
    expect(kinds).toContain('lead')
  })

  it('reset (restart) clears everything pending', () => {
    const c = new RaceCallouts()
    run(c, 0, 500, () => ({ position: 3 }))
    run(c, 550, 1900, () => ({ position: 2 }))
    expect(c.current).not.toBeNull()
    c.reset()
    expect(c.current).toBeNull()
    expect(run(c, 0, 3000, () => ({ position: 2 }))).toEqual([])
  })
})
