import { expect, it } from 'vitest'
import { isResultRecord } from '../server/src/ResultRecord'
import { parseHistoryPage } from '../src/cloud/practiceHistoryData'
import { savedRace, resultPlayers } from './helpers/resultRecord'
function retiredRecord() {
  const record = savedRace()
  record.protocol = 3; record.ruleset = 'online-practice-v2'
  record.result.reason = 'all-resolved'; record.result.completedTick = 380
  record.result.racers[1] = { ...record.result.racers[1], status: 'dnf', rank: null, finishTicks: null,
    lapTicks: [], retiredTicks: 100, dnfReason: 'left' }
  return record
}
it('validates legacy replay and new terminal retirements, refusing forged times and ranks', () => {
  expect(isResultRecord(savedRace())).toBe(true)
  expect(isResultRecord(retiredRecord())).toBe(true)
  for (const mutate of [
    (r: ReturnType<typeof retiredRecord>) => { r.protocol = 2 },
    (r: ReturnType<typeof retiredRecord>) => { r.result.racers[1].retiredTicks = 201 },
    (r: ReturnType<typeof retiredRecord>) => { r.result.racers[1].dnfReason = undefined },
    (r: ReturnType<typeof retiredRecord>) => { r.result.racers[1].rank = 1 },
    (r: ReturnType<typeof retiredRecord>) => { r.result.racers[1].lapTicks = [101] },
    (r: ReturnType<typeof retiredRecord>) => { r.result.completedTick = 400 },
  ]) {
    const invalid = retiredRecord(); mutate(invalid)
    expect(isResultRecord(invalid)).toBe(false)
  }
})
it('reads owner retirement history without converting DNF into a ranked finish', () => {
  const row = { race_id: savedRace().result.raceId, player_id: resultPlayers[1], recorded_at: '2026-10-23T12:00:00Z',
    track: 'nurburgring', laps: 2, car_id: 'diablo', status: 'dnf', rank: null, finish_ticks: null,
    lap_ticks: [], reason: 'all-resolved', fingerprint: 'a'.repeat(64), simulation_version: 1,
    race_protocol: 3, ruleset: 'online-practice-v2', leaderboard_eligible: false, retired_ticks: 100, dnf_reason: 'left' }
  expect(parseHistoryPage([row], resultPlayers[1])[0]).toMatchObject({ status: 'dnf', rank: null, finish_ticks: null, dnf_reason: 'left' })
  expect(() => parseHistoryPage([{ ...row, race_protocol: 2 }], resultPlayers[1])).toThrow()
  expect(() => parseHistoryPage([{ ...row, retired_ticks: null }], resultPlayers[1])).toThrow()
})
