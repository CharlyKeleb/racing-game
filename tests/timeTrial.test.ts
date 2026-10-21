import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RaceManager } from '../src/racing/RaceManager'
import { readTrialRecord, saveTrialRecord, TimeTrialSession, trialBuildKey } from '../src/racing/TimeTrial'
import { DEFAULT_BUILD } from '../src/vehicles/CarBuild'
import type { Checkpoint } from '../src/world/Track'

describe('time trial session', () => {
  it('first valid lap becomes the session and personal best; splits compare against it after', () => {
    const t = new TimeTrialSession()
    t.start(null)
    expect(t.checkpoint(1, 20_000)).toBeNull()
    t.checkpoint(2, 41_000)
    const first = t.completeLap(60_000)
    expect(first).toMatchObject({ valid: true, sessionBest: true, personalBest: true, deltaMs: null })
    expect(t.personalBest?.splits[1]).toBe(20_000)

    expect(t.checkpoint(1, 19_500)).toBe(-500)
    expect(t.checkpoint(2, 41_250)).toBe(250)
    const second = t.completeLap(59_000)
    expect(second).toMatchObject({ valid: true, sessionBest: true, personalBest: true, deltaMs: -1000 })
    expect(t.sessionBest?.lapMs).toBe(59_000)
  })

  it('a reset or missed gate voids the lap: timed, but never a best', () => {
    const t = new TimeTrialSession()
    t.start({ lapMs: 70_000, splits: [] })
    t.invalidate('reset')
    const lap = t.completeLap(50_000)
    expect(lap.valid).toBe(false)
    expect(lap.personalBest).toBe(false)
    expect(t.personalBest?.lapMs).toBe(70_000)
    expect(t.sessionBest).toBeNull()
    // The next lap starts valid again.
    expect(t.valid).toBe(true)
    t.invalidate('missed')
    expect(t.invalidReason).toBe('missed')
    t.completeLap(65_000)
    expect(t.laps).toEqual([{ lapMs: 50_000, valid: false }, { lapMs: 65_000, valid: false }])
    expect(t.validLaps).toBe(0)
  })

  it('a slower valid lap keeps the stored personal best', () => {
    const t = new TimeTrialSession()
    t.start({ lapMs: 58_000, splits: [undefined as unknown as number, 19_000] })
    expect(t.checkpoint(1, 19_400)).toBe(400)
    const lap = t.completeLap(60_000)
    expect(lap).toMatchObject({ valid: true, sessionBest: true, personalBest: false, deltaMs: 2000 })
    expect(t.personalBest?.lapMs).toBe(58_000)
  })

  it('restartLap clears the current lap but keeps the session', () => {
    const t = new TimeTrialSession()
    t.start(null)
    t.completeLap(61_000)
    t.checkpoint(1, 5_000)
    t.invalidate('reset')
    t.restartLap()
    expect(t.valid).toBe(true)
    expect(t.splits.length).toBe(0)
    expect(t.sessionBest?.lapMs).toBe(61_000)
  })
})

describe('time trial records', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('are keyed by circuit, car and performance build only', () => {
    const key = trialBuildKey(DEFAULT_BUILD)
    expect(trialBuildKey({ ...DEFAULT_BUILD, paint: '#000000', spoiler: DEFAULT_BUILD.spoiler })).toBe(key)
    expect(trialBuildKey({ ...DEFAULT_BUILD, engine: 2 })).not.toBe(key)
    saveTrialRecord('nurburgring', 'porsche911', key, { lapMs: 61_234, splits: [0, 20_000] })
    expect(readTrialRecord('nurburgring', 'porsche911', key)?.lapMs).toBe(61_234)
    expect(readTrialRecord('nurburgring', 'bmw', key)).toBeNull()
    expect(readTrialRecord('singapore', 'porsche911', key)).toBeNull()
  })

  it('ignores corrupt or blocked storage', () => {
    localStorage.setItem(`racing-game:trial:t:c:${trialBuildKey(DEFAULT_BUILD)}:v1`, '{"lapMs":-5}')
    expect(readTrialRecord('t', 'c', trialBuildKey(DEFAULT_BUILD))).toBeNull()
    vi.stubGlobal('localStorage', { getItem: () => { throw Error('Blocked') }, setItem: () => { throw Error('Blocked') } })
    expect(readTrialRecord('t', 'c', 'k')).toBeNull()
    expect(() => saveTrialRecord('t', 'c', 'k', { lapMs: 1, splits: [] })).not.toThrow()
  })
})

/** Three gates on a straight line along +Z: start line at 0, then 100 m and 200 m. */
function gates(): Checkpoint[] {
  return [0, 100, 200].map((z, index) => ({ index, position: new THREE.Vector3(0, 0, z), tangent: new THREE.Vector3(0, 0, 1), radius: 10 }))
}

/** Drive from z0 to z1 at `speed` m/s in fixed ticks. */
function drive(race: RaceManager, z0: number, z1: number, speed = 50): void {
  const p = new THREE.Vector3()
  for (let z = z0; z <= z1; z += speed / 60) race.update(1 / 60, p.set(0, 0, z))
}

describe('race manager modes', () => {
  it('time trial runs laps until the player leaves and reports checkpoint splits', () => {
    const splits: [number, number][] = []
    const laps: number[] = []
    const race = new RaceManager(gates(), 3, { onStateChange: () => {}, onLap: (_l, ms) => laps.push(ms), onCheckpoint: (i, ms) => splits.push([i, ms]) })
    race.start(Infinity, 0)
    race.update(3, new THREE.Vector3(0, 0, -5))
    expect(race.state).toBe('racing')
    for (let lap = 0; lap < 5; lap++) {
      drive(race, -5, 250)
      // Loop back around behind the start line (out of every gate's radius).
      race.update(1 / 60, new THREE.Vector3(500, 0, 100))
      race.update(1 / 60, new THREE.Vector3(0, 0, -5))
    }
    expect(race.state).toBe('racing')
    expect(laps.length).toBe(4)
    expect(splits.filter(([i]) => i === 1).length).toBe(5)
    expect(splits[0][1]).toBeGreaterThan(1900)
    expect(splits[0][1]).toBeLessThan(2200)
  })

  it('free roam drives at once, with no clock, laps or finish, but keeps checkpoints for resets', () => {
    const states: string[] = []
    const laps: number[] = []
    const race = new RaceManager(gates(), 1, { onStateChange: (s) => states.push(s), onLap: (l) => laps.push(l), onCheckpoint: () => { throw new Error('no splits in free roam') } })
    race.startFreeRoam()
    expect(states).toEqual(['racing'])
    expect(race.controlsEnabled).toBe(true)
    drive(race, -5, 250)
    expect(race.lastCheckpoint).toBe(2)
    race.update(1 / 60, new THREE.Vector3(500, 0, 100))
    drive(race, -5, 50)
    expect(race.state).toBe('racing')
    expect(laps).toEqual([])
    expect(race.timer.totalMs).toBe(0)
  })
})
