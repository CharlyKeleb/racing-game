import type { LobbyCar } from '../../server/src/protocol'
import { isLobbyCar } from '../../server/src/protocol'
export interface PracticeHistoryEntry {
  race_id: string
  player_id: string
  recorded_at: string
  track: 'nurburgring'
  laps: number
  car_id: LobbyCar
  status: 'finished' | 'dnf'
  rank: number | null
  finish_ticks: number | null
  lap_ticks: number[]
  reason: 'all-finished' | 'finish-window' | 'time-limit'
  fingerprint: string
  simulation_version: number
  race_protocol: 2
  ruleset: 'online-practice-v1'
  leaderboard_eligible: false
}
export interface HistoryCursor { at: string; id: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max

/** Display-only history cannot award rewards, records or competitive eligibility. */
export function parseHistoryPage(value: unknown, playerId: string): PracticeHistoryEntry[] {
  if (!Array.isArray(value) || value.length > 21) throw new Error('Invalid history page')
  const ids = new Set<string>()
  return value.map((entry: PracticeHistoryEntry) => {
    if (!entry || typeof entry.race_id !== 'string' || !uuid.test(entry.race_id) || ids.has(entry.race_id)
      || entry.player_id !== playerId || typeof entry.recorded_at !== 'string' || !Number.isFinite(Date.parse(entry.recorded_at))
      || entry.track !== 'nurburgring' || !integer(entry.laps, 1, 10) || !isLobbyCar(entry.car_id)
      || entry.ruleset !== 'online-practice-v1' || entry.leaderboard_eligible !== false || entry.race_protocol !== 2
      || !integer(entry.simulation_version, 1, 1_000_000) || typeof entry.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(entry.fingerprint)
      || !['all-finished', 'finish-window', 'time-limit'].includes(entry.reason)
      || !Array.isArray(entry.lap_ticks) || entry.lap_ticks.length > entry.laps
      || !entry.lap_ticks.every((tick: unknown) => integer(tick, 1, 36_000))) throw new Error('Invalid history entry')
    const sum = entry.lap_ticks.reduce((a: number, b: number) => a + b, 0)
    if (entry.status === 'finished') {
      if (!integer(entry.rank, 1, 2) || !integer(entry.finish_ticks, 1, 36_000)
        || entry.lap_ticks.length !== entry.laps || sum !== entry.finish_ticks) throw new Error('Invalid history finish')
    } else if (entry.status !== 'dnf' || entry.rank !== null || entry.finish_ticks !== null
      || entry.lap_ticks.length >= entry.laps || sum > 36_000) throw new Error('Invalid history DNF')
    ids.add(entry.race_id)
    return { ...entry, lap_ticks: [...entry.lap_ticks] }
  })
}
