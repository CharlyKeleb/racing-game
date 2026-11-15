import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAREER, CAREER_RUNGS, SUMMIT, careerEvent, careerPassed, careerStatus, eliminationDue, formatLap } from '../src/racing/Career'
import { careerStore, CAREER_KEY } from '../src/stores/careerStore'
import { mergeSnapshots } from '../src/cloud/saveData'
import { RaceManager } from '../src/racing/RaceManager'
import { selectableCars } from '../src/vehicles/carRegistry'
import { isAiDifficulty } from '../src/racing/AiProfiles'
import { NURBURGRING, MARINA_BAY, BAYVIEW, PARIS, CANYON_DAM } from '../src/world/tracks'
import { carPrice } from '../src/racing/Economy'

const ids = (list: readonly { id: string }[]) => list.map((e) => e.id)

describe('career ladder', () => {
  it('is driven in the RS6-R and the Skyline, on real circuits, from Legend up', () => {
    const tracks = new Set([NURBURGRING, MARINA_BAY, BAYVIEW, PARIS, CANYON_DAM].map((t) => t.id))
    const cars = new Set(selectableCars().map((c) => c.id))
    for (const e of CAREER) {
      expect(['rs6r', 'r33']).toContain(e.car)
      expect(cars.has(e.car), e.id).toBe(true)
      expect(carPrice(e.car), `${e.car} must be free to drive`).toBe(0)
      expect(tracks.has(e.track), e.id).toBe(true)
      expect(isAiDifficulty(e.difficulty)).toBe(true)
      // Rival counts the race setup accepts.
      expect([0, 1, 3, 7]).toContain(e.rivals)
      if (e.kind === 'timeTrial') { expect(e.rivals).toBe(0); expect(e.targetMs).toBeGreaterThan(30000) }
      if (e.kind === 'elimination') expect(e.laps).toBe(e.rivals + 1)
      if (e.kind === 'race') expect(e.maxPosition).toBe(1)
    }
    expect(new Set(ids(CAREER)).size).toBe(CAREER.length)
  })

  it('every link climbs one rung, and the columns keep to the 3-wide grid', () => {
    for (const e of CAREER) {
      expect(e.column).toBeGreaterThanOrEqual(0)
      expect(e.column).toBeLessThanOrEqual(2)
      for (const id of e.next) expect(careerEvent(id)?.rung, `${e.id} → ${id}`).toBe(e.rung + 1)
    }
    // No two events share a cell.
    expect(new Set(CAREER.map((e) => `${e.rung}/${e.column}`)).size).toBe(CAREER.length)
  })

  it('is a maze: the summit can be reached, but some routes dead-end', () => {
    const reach = new Set(CAREER.filter((e) => e.rung === 0).map((e) => e.id))
    for (let r = 0; r < CAREER_RUNGS; r++) for (const e of CAREER) if (reach.has(e.id)) e.next.forEach((id) => reach.add(id))
    expect(reach.size).toBe(CAREER.length)
    expect(reach.has(SUMMIT)).toBe(true)
    const deadEnds = CAREER.filter((e) => e.next.length === 0 && e.id !== SUMMIT)
    expect(deadEnds.length).toBeGreaterThanOrEqual(2)
    // More than one way up: some event is opened from two different events.
    expect(CAREER.some((e) => CAREER.filter((f) => f.next.includes(e.id)).length > 1)).toBe(true)
    // The top rungs are Impossible.
    expect(careerEvent(SUMMIT)?.difficulty).toBe('impossible')
    expect(careerEvent(SUMMIT)?.rivals).toBe(7)
  })

  it('opens the bottom rung, then only what a win links to', () => {
    const none = new Set<string>()
    expect(careerStatus('paris-sprint', none)).toBe('open')
    expect(careerStatus('first-cut', none)).toBe('locked')
    const won = new Set(['paris-sprint'])
    expect(careerStatus('paris-sprint', won)).toBe('won')
    expect(careerStatus('first-cut', won)).toBe('open')
    expect(careerStatus('marina-shakedown', won)).toBe('open')
    expect(careerStatus('dam-run', won)).toBe('locked')
    expect(careerStatus(SUMMIT, won)).toBe('locked')
    expect(careerStatus('nope', won)).toBe('locked')
  })

  it('judges each kind of event', () => {
    const race = careerEvent('paris-sprint')!, trial = careerEvent('bayview-hotlap')!, elim = careerEvent('first-cut')!
    expect(careerPassed(race, { kind: 'race', position: 1, field: 4 })).toBe(true)
    expect(careerPassed(race, { kind: 'race', position: 2, field: 4 })).toBe(false)
    expect(careerPassed(trial, { kind: 'timeTrial', bestLapMs: trial.targetMs! })).toBe(true)
    expect(careerPassed(trial, { kind: 'timeTrial', bestLapMs: trial.targetMs! + 1 })).toBe(false)
    expect(careerPassed(trial, { kind: 'timeTrial', bestLapMs: null })).toBe(false)
    expect(careerPassed(elim, { kind: 'elimination', eliminated: false, lap: 4 })).toBe(true)
    expect(careerPassed(elim, { kind: 'elimination', eliminated: true, lap: 2 })).toBe(false)
    expect(formatLap(51300)).toBe('0:51.3')
    expect(formatLap(111233)).toBe('1:51.2')
  })
})

describe('elimination', () => {
  it('knocks out the last car once per lap the leader starts', () => {
    const order = [2, 0, 3, 1]
    expect(eliminationDue(order, 1, 0)).toBeNull()
    expect(eliminationDue(order, 2, 0)).toBe(1)
    expect(eliminationDue([2, 0, 3], 2, 1)).toBeNull()
    expect(eliminationDue([2, 0, 3], 3, 1)).toBe(3)
    expect(eliminationDue([2, 0], 4, 2)).toBe(0)
    // One car left: nobody is due.
    expect(eliminationDue([0], 9, 3)).toBeNull()
  })

  it('a retired race stops its clock and finishes, once', () => {
    const states: string[] = []
    const race = new RaceManager([], 4, { onStateChange: (s) => states.push(s), onLap: () => {} })
    race.retire()
    expect(race.state).not.toBe('finished')
    race.state = 'racing'
    race.timer.running = true
    race.retire()
    expect(race.state).toBe('finished')
    expect(race.timer.running).toBe(false)
    expect(states).toEqual(['finished'])
  })
})

describe('career progress', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) })
    careerStore.getState().reset()
    careerStore.setState({ active: null, stash: null, lastResult: null })
  })

  it('wins are saved once, retries do not double count, and a locked event cannot start', () => {
    const s = careerStore.getState()
    s.begin('first-cut', {})
    expect(careerStore.getState().active).toBeNull()
    s.begin('paris-sprint', { car: 'porsche911' })
    expect(careerStore.getState().active).toBe('paris-sprint')
    expect(careerStore.getState().record({ kind: 'race', position: 2, field: 4 })?.passed).toBe(false)
    // One result per run: the Game clears it when the event restarts.
    careerStore.setState({ lastResult: null })
    const win = careerStore.getState().record({ kind: 'race', position: 1, field: 4 })
    expect(win).toMatchObject({ passed: true, firstWin: true })
    expect(JSON.parse(localStorage.getItem(CAREER_KEY)!)).toEqual({ won: ['paris-sprint'] })
    careerStore.setState({ lastResult: null })
    expect(careerStore.getState().record({ kind: 'race', position: 1, field: 4 })?.firstWin).toBe(false)
    expect(careerStore.getState().won).toEqual(['paris-sprint'])
    // Leaving hands back the setup it took over.
    expect(careerStore.getState().end()).toEqual({ car: 'porsche911' })
    expect(careerStore.getState().active).toBeNull()
  })

  it('cloud saves keep every event won on either device', () => {
    const snap = (won: string[]) => ({ version: 1 as const, entries: { [CAREER_KEY]: JSON.stringify({ won }) } })
    const merged = mergeSnapshots(snap(['paris-sprint', 'first-cut']), snap(['paris-sprint', 'bayview-hotlap']))
    expect(JSON.parse(merged.entries[CAREER_KEY]).won.sort()).toEqual(['bayview-hotlap', 'first-cut', 'paris-sprint'])
  })
})
