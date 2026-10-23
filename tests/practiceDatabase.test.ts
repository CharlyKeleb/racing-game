import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { practiceDatabase } from './helpers/practiceDatabase'
import { resultPlayers, savedRace } from './helpers/resultRecord'
let db: PGlite
beforeAll(async () => { db = await practiceDatabase() }, 30_000)
afterAll(async () => { await db?.close() })
const record = savedRace()
beforeEach(async () => {
  await db.exec('truncate public.online_practice_history, public.online_practice_races')
  await write(record)
})
async function role(name: 'anon' | 'authenticated' | 'service_role', action: () => Promise<void>) {
  await db.exec(`set role ${name}`)
  try { await action() } finally { await db.exec('reset role') }
}
const write = (record: unknown) => db.query<{ saved: { raceId: string; savedAt: string } }>('select public.record_online_practice($1::jsonb) as saved', [JSON.stringify(record)])
it('commits both racers atomically and returns exactly the same receipt on retry', async () => {
  await role('service_role', async () => {
    const a = await write(record), b = await write(record)
    expect(a.rows).toEqual(b.rows)
    expect(a.rows[0].saved.raceId).toBe(record.result.raceId)
  })
  expect((await db.query('select * from public.online_practice_races')).rows).toHaveLength(1)
  expect((await db.query('select * from public.online_practice_history')).rows).toHaveLength(2)
})
it('rejects conflicting reuse and malformed/unapproved results without partial writes', async () => {
  await role('service_role', async () => {
    const conflict = structuredClone(record); conflict.fingerprint = 'b'.repeat(64)
    await expect(write(conflict)).rejects.toMatchObject({ code: '23505' })
    for (const mutate of [
      (r: typeof record) => { r.result.racers[1].rank = 1 },
      (r: typeof record) => { r.result.racers[1].id = resultPlayers[0] },
      (r: typeof record) => { r.result.racers[1].lapTicks = [1] },
      (r: typeof record) => { r.result.completedTick = 1e9 },
      (r: typeof record) => { r.ruleset = 'competitive-v1' as never },
    ]) {
      const invalid = savedRace('20000000-0000-4000-8000-000000000002'); mutate(invalid)
      await expect(write(invalid)).rejects.toMatchObject({ code: '22023' })
    }
    const missing = savedRace('20000000-0000-4000-8000-000000000002')
    missing.result.racers[1].id = '10000000-0000-4000-8000-000000000099'
    await expect(write(missing)).rejects.toMatchObject({ code: '23503' })
  })
  expect((await db.query('select * from public.online_practice_races')).rows).toHaveLength(1)
  expect((await db.query('select * from public.online_practice_history')).rows).toHaveLength(2)
})
it('permits only owner reads and denies browser result RPCs, direct writes and raw race reads', async () => {
  await role('authenticated', async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [resultPlayers[0]])
    const own = (await db.query('select * from public.my_online_practice_history()')).rows
    expect(own).toHaveLength(1)
    expect(own[0]).toMatchObject({ player_id: resultPlayers[0], leaderboard_eligible: false, ruleset: 'online-practice-v1' })
    expect((await db.query('select * from public.online_practice_history where player_id=$1', [resultPlayers[1]])).rows).toEqual([])
    await expect(write(record)).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec('update public.online_practice_history set rank=1')).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec('delete from public.online_practice_history')).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec('select * from public.online_practice_races')).rejects.toMatchObject({ code: '42501' })
  })
  await role('anon', async () => {
    await expect(write(record)).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec('select * from public.my_online_practice_history()')).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec('select * from public.online_practice_history')).rejects.toMatchObject({ code: '42501' })
  })
  await role('service_role', async () => {
    await expect(db.exec('update public.online_practice_history set rank=1')).rejects.toMatchObject({ code: '42501' })
  })
})
it('persists ties and DNF without fabricating times or ranks', async () => {
  const tie = savedRace('20000000-0000-4000-8000-000000000003')
  tie.result.racers[1] = { ...tie.result.racers[1], rank: 1, finishTicks: 200, lapTicks: [100, 100] }
  tie.result.completedTick = 380
  const dnf = savedRace('20000000-0000-4000-8000-000000000004')
  dnf.result.reason = 'finish-window'; dnf.result.completedTick = 3980
  dnf.result.racers[1] = { ...dnf.result.racers[1], status: 'dnf', rank: null, finishTicks: null, lapTicks: [150] }
  await role('service_role', async () => { await write(tie); await write(dnf) })
  const rows = (await db.query('select status,rank,finish_ticks from public.online_practice_history where race_id=$1 order by player_id', [dnf.result.raceId])).rows
  expect(rows).toEqual([{ status: 'finished', rank: 1, finish_ticks: 200 }, { status: 'dnf', rank: null, finish_ticks: null }])
})
it('paginates same-timestamp results by race UUID without skips or duplicate rows', async () => {
  for (let i = 10; i < 35; i++) await write(savedRace(`20000000-0000-4000-8000-${String(i).padStart(12, '0')}`))
  await db.exec("update public.online_practice_history set recorded_at='2026-10-23T12:00:00Z'")
  await role('authenticated', async () => {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [resultPlayers[0]])
    const first = (await db.query('select * from public.my_online_practice_history()')).rows
    expect(first).toHaveLength(21)
    const last = first[19]
    const rest = (await db.query('select * from public.my_online_practice_history($1,$2)', [last.recorded_at, last.race_id])).rows
    expect(new Set([...first.slice(0, 20), ...rest].map(row => row.race_id)).size).toBe(26)
    expect(rest).toHaveLength(6)
  })
})

it('stores v2 retirement metadata atomically and preserves v1 replay receipts', async () => {
  const v2 = structuredClone(savedRace('20000000-0000-4000-8000-000000000050'))
  v2.protocol = 3; v2.ruleset = 'online-practice-v2'; v2.result.reason = 'all-resolved'
  v2.result.completedTick = 380
  v2.result.racers[1] = { ...v2.result.racers[1], status: 'dnf', rank: null, finishTicks: null,
    lapTicks: [], retiredTicks: 100, dnfReason: 'connection-lost' }
  await role('service_role', async () => {
    const receipt = await write(v2)
    expect((await write(v2)).rows).toEqual(receipt.rows)
    expect((await write(record)).rows[0].saved.raceId).toBe(record.result.raceId)
  })
  const rows = (await db.query('select * from public.online_practice_history where race_id=$1 order by player_id', [v2.result.raceId])).rows
  expect(rows[1]).toMatchObject({ status: 'dnf', retired_ticks: 100, dnf_reason: 'connection-lost', race_protocol: 3, ruleset: 'online-practice-v2', leaderboard_eligible: false })
  for (const change of [
    (r: typeof v2) => { r.protocol = 2 },
    (r: typeof v2) => { r.result.racers[1].retiredTicks = 201 },
    (r: typeof v2) => { r.result.racers[1].dnfReason = 'winner' as never },
    (r: typeof v2) => { r.result.racers[1].lapTicks = [101] },
    (r: typeof v2) => { r.result.racers[1].retiredTicks = undefined },
    (r: typeof v2) => { r.result.completedTick = 400 },
  ]) {
    const bad = structuredClone(v2); bad.result.raceId = '20000000-0000-4000-8000-000000000051'; change(bad)
    await role('service_role', async () => { await expect(write(bad)).rejects.toMatchObject({ code: '22023' }) })
  }
})
