import { describe, expect, it } from 'vitest'
import { MidRaceCommentary } from '../src/audio/MidRaceCommentary'

const race = { mode: 'quick' as const, timeMs: 16000, speedKmh: 100, driftScoring: false, lap: 1, totalLaps: 3 }
describe('mid-race commentary', () => {
  it('fills a quiet unchanged-position race, with alternating coaching spaced apart', () => {
    const cues = new MidRaceCommentary()
    expect(cues.update(race, 12000)).toBe('focus')
    expect(cues.update({ ...race, timeMs: 30000 }, 14000)).toBeNull()
    expect(cues.update({ ...race, timeMs: 38000 }, 18000)).toBe('rhythm')
  })
  it('does not crowd recent speech, start cues, stopped cars or free roam', () => {
    const cues = new MidRaceCommentary()
    expect(cues.update({ ...race, timeMs: 13000 }, 20000)).toBeNull()
    expect(cues.update(race, 11999)).toBeNull()
    expect(cues.update({ ...race, speedKmh: 0 }, 20000)).toBeNull()
    expect(cues.update({ ...race, mode: 'freeRoam' }, 20000)).toBeNull()
    expect(cues.update(race, 20000)).toBe('focus')
  })
  it('reacts to an active drift or gives initiation advice when not scoring', () => {
    const cues = new MidRaceCommentary()
    expect(cues.update({ ...race, mode: 'drift', driftScoring: true }, 12000)).toBe('driftFlow')
    expect(cues.update({ ...race, mode: 'drift', timeMs: 38000 }, 20000)).toBe('driftSetup')
  })
  it('announces the final drift lap once even during other commentary', () => {
    const cues = new MidRaceCommentary()
    expect(cues.update({ ...race, mode: 'drift', lap: 3 }, 0)).toBe('finalLap')
    expect(cues.update({ ...race, mode: 'drift', lap: 3 }, 0)).toBeNull()
    cues.reset()
    expect(cues.update({ ...race, mode: 'drift', lap: 3 }, 0)).toBe('finalLap')
  })
  it('leaves Quick Race final laps to the existing race callout system', () => {
    expect(new MidRaceCommentary().update({ ...race, lap: 3 }, 0)).toBeNull()
    expect(new MidRaceCommentary().update({ ...race, mode: 'timeTrial', totalLaps: Infinity }, 0)).toBeNull()
  })
})
