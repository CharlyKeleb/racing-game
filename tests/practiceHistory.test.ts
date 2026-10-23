import { afterEach, expect, it, vi } from 'vitest'
import { PracticeHistory } from '../src/cloud/PracticeHistoryLoader'
import { parseHistoryPage, type PracticeHistoryEntry } from '../src/cloud/practiceHistoryData'
import { raceHistoryStore } from '../src/stores/raceHistoryStore'
import { accountStore } from '../src/stores/accountStore'
import { savedRace, resultPlayers } from './helpers/resultRecord'
function row(id = savedRace().result.raceId): PracticeHistoryEntry {
  return { race_id: id, player_id: resultPlayers[0], recorded_at: '2026-10-23T17:00:00Z', track: 'nurburgring', laps: 2,
    car_id: 'porsche911', status: 'finished', rank: 1, finish_ticks: 200, lap_ticks: [100, 100], reason: 'all-finished',
    fingerprint: 'a'.repeat(64), simulation_version: 1, race_protocol: 2, ruleset: 'online-practice-v1', leaderboard_eligible: false }
}
const loaders: PracticeHistory[] = []
afterEach(() => { for (const h of loaders.splice(0)) h.dispose(); accountStore.setState(accountStore.getInitialState(), true); raceHistoryStore.setState(raceHistoryStore.getInitialState(), true) })
function fixture() {
  accountStore.setState({ player: { id: resultPlayers[0], email: null, name: null, avatarUrl: null } })
  const result = vi.fn(), rpc = vi.fn(() => ({ abortSignal: result }))
  const loader = new PracticeHistory(async () => ({ rpc }) as never, () => accountStore.getState().player?.id ?? null)
  loaders.push(loader)
  return { loader, result, rpc }
}
it('uses bounded keyset pages and replaces each page instead of accumulating unbounded history', async () => {
  const f = fixture()
  const first = Array.from({ length: 21 }, (_, i) => row(`20000000-0000-4000-8000-${String(i).padStart(12, '0')}`))
  f.result.mockResolvedValueOnce({ data: first, error: null })
  await f.loader.load()
  expect(raceHistoryStore.getState()).toMatchObject({ status: 'ready', hasMore: true, rows: first.slice(0, 20), cursor: { at: first[19].recorded_at, id: first[19].race_id } })
  f.result.mockResolvedValueOnce({ data: [first[20]], error: null })
  await f.loader.load(true)
  expect(f.rpc).toHaveBeenLastCalledWith('my_online_practice_history', { before_at: first[19].recorded_at, before_id: first[19].race_id })
  expect(raceHistoryStore.getState()).toMatchObject({ status: 'ready', rows: [first[20]], hasMore: false })
})
it('clears history immediately on logout/account switch and ignores a late response', async () => {
  const f = fixture()
  let finish!: (value: unknown) => void
  f.result.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const pending = f.loader.load()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  accountStore.setState({ player: { id: resultPlayers[1], email: null, name: null, avatarUrl: null } })
  expect(raceHistoryStore.getState()).toMatchObject({ playerId: resultPlayers[1], rows: [], status: 'idle' })
  finish({ data: [row()], error: null }); await pending
  expect(raceHistoryStore.getState().rows).toEqual([])
})
it('ignores responses superseded by a refresh and offers retry after a read failure', async () => {
  const f = fixture()
  let finish!: (value: unknown) => void
  f.result.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const old = f.loader.load()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  f.result.mockResolvedValueOnce({ data: [], error: null }); await f.loader.load()
  finish({ data: [row()], error: null }); await old
  expect(raceHistoryStore.getState().rows).toEqual([])
  f.result.mockResolvedValueOnce({ data: null, error: new Error('database unavailable') }); await f.loader.load()
  expect(raceHistoryStore.getState().status).toBe('error')
  f.result.mockResolvedValueOnce({ data: [row()], error: null }); await f.loader.load()
  expect(raceHistoryStore.getState().rows).toEqual([row()])
})
it('rejects another owner, competitive eligibility, duplicate IDs and invalid times', () => {
  for (const extra of [{ player_id: resultPlayers[1] }, { leaderboard_eligible: true }, { finish_ticks: NaN }, { lap_ticks: [0, 200] }]) {
    expect(() => parseHistoryPage([{ ...row(), ...extra }], resultPlayers[0])).toThrow()
  }
  expect(() => parseHistoryPage([row(), row()], resultPlayers[0])).toThrow()
  expect(() => parseHistoryPage(Array(22).fill(row()), resultPlayers[0])).toThrow()
  const source = row(), parsed = parseHistoryPage([source], resultPlayers[0])
  source.lap_ticks[0] = 999
  expect(parsed[0].lap_ticks).toEqual([100, 100])
})
