import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capPayout, carPrice, DAILY_SOFT_CAP, raceReward, STARTER_CARS, STARTING_COINS } from '../src/racing/Economy'
import { mergeSnapshots } from '../src/cloud/saveData'
import { readWallet, walletStore, WALLET_KEY } from '../src/stores/walletStore'

const total = (lines: { coins: number }[]) => lines.reduce((s, l) => s + l.coins, 0)
const quick = { mode: 'quick' as const, field: 4, laps: 3, bestLapMs: 90_000, previousBestLapMs: 89_000, difficulty: 'legend' as const }

describe('race rewards', () => {
  it('pays a win most, then the podium, then a finish', () => {
    const win = total(raceReward({ ...quick, position: 1 })), second = total(raceReward({ ...quick, position: 2 }))
    const third = total(raceReward({ ...quick, position: 3 })), fourth = total(raceReward({ ...quick, position: 4 }))
    expect(win).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(third)
    expect(third).toBeGreaterThan(fourth)
    expect(win).toBeGreaterThan(450)
    expect(win).toBeLessThan(600)
  })

  it('pays a lap record, a smaller first time, nothing for a slower lap', () => {
    const base = total(raceReward({ ...quick, position: 4 }))
    expect(total(raceReward({ ...quick, position: 4, bestLapMs: 88_000 }))).toBe(base + 75)
    expect(total(raceReward({ ...quick, position: 4, previousBestLapMs: null }))).toBe(base + 25)
  })

  it("doesn't make 1-lap sprints the farm", () => {
    const sprint = total(raceReward({ ...quick, laps: 1, position: 1 })), race = total(raceReward({ ...quick, laps: 3, position: 1 }))
    // Three sprints take about as long as one race and must pay less.
    expect(sprint * 3).toBeLessThan(race * 1.1)
  })

  it('pays harder rivals more, and no podium without rivals', () => {
    expect(total(raceReward({ ...quick, position: 1, difficulty: 'impossible' }))).toBeGreaterThan(total(raceReward({ ...quick, position: 1, difficulty: 'mythic' })))
    expect(raceReward({ ...quick, position: 1, field: 1 }).some((l) => /Victory|podium/.test(l.label))).toBe(false)
  })

  it('pays time trial laps up to a cap, and drift points and medals', () => {
    expect(total(raceReward({ mode: 'timeTrial', validLaps: 40, bestLapMs: null, previousBestLapMs: null }))).toBe(150)
    expect(total(raceReward({ mode: 'drift', score: 30_000, medal: 3 }))).toBe(20 + 100)
    expect(raceReward({ mode: 'drift', score: 0, medal: 0 })).toEqual([])
  })

  it('pays a quarter past the daily soft cap', () => {
    expect(capPayout(300, 0)).toBe(300)
    expect(capPayout(300, DAILY_SOFT_CAP - 100)).toBe(100 + 50)
    expect(capPayout(400, DAILY_SOFT_CAP + 10)).toBe(100)
  })

  it('prices the fastest car at about sixty Legend wins', () => {
    const win = total(raceReward({ ...quick, position: 1 }))
    expect(carPrice('koenigsegg') / win).toBeGreaterThan(50)
    expect(STARTER_CARS).toContain('porsche911')
  })
})

describe('wallet', () => {
  beforeEach(() => {
    const data = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) })
    walletStore.getState().reloadSaved()
  })

  it('starts new players with coins and the starter cars, and keeps the car they already drive', () => {
    const w = readWallet(null, 'charger')
    expect(w.coins).toBe(STARTING_COINS)
    expect(w.owned).toEqual(expect.arrayContaining([...STARTER_CARS, 'charger']))
    // A saved wallet doesn't get the current car for free.
    expect(readWallet(JSON.stringify({ coins: 10, owned: [] }), 'charger').owned).not.toContain('charger')
  })

  it('buys a car only with enough coins, once, and saves', () => {
    const s = walletStore.getState()
    expect(s.buy('charger')).toBe(false)
    walletStore.setState({ coins: 12500 })
    expect(walletStore.getState().buy('charger')).toBe(true)
    expect(walletStore.getState().coins).toBe(500)
    expect(walletStore.getState().buy('charger')).toBe(false)
    expect(JSON.parse(localStorage.getItem(WALLET_KEY)!).owned).toContain('charger')
  })

  it('awards with the daily cap and remembers the payout', () => {
    walletStore.setState({ earnedToday: DAILY_SOFT_CAP, day: walletStore.getState().day })
    const before = walletStore.getState().coins
    const payout = walletStore.getState().award([{ label: 'Victory', coins: 200 }])
    expect(payout.paid).toBe(50)
    expect(walletStore.getState().coins).toBe(before + 50)
    expect(walletStore.getState().lastPayout).toEqual(payout)
  })

  it('merges cloud wallets: cloud coins, every owned car, best laps', () => {
    const local = { version: 1 as const, entries: { [WALLET_KEY]: JSON.stringify({ coins: 9000, owned: ['porsche911', 'amg'], bestLaps: { city: 80_000 } }) } }
    const cloud = { version: 1 as const, entries: { [WALLET_KEY]: JSON.stringify({ coins: 1200, owned: ['porsche911', 'bmw'], bestLaps: { city: 82_000, canyon: 120_000 } }) } }
    const merged = JSON.parse(mergeSnapshots(local, cloud).entries[WALLET_KEY])
    expect(merged.coins).toBe(1200)
    expect(merged.owned.sort()).toEqual(['amg', 'bmw', 'porsche911'])
    expect(merged.bestLaps).toEqual({ city: 80_000, canyon: 120_000 })
  })
})
