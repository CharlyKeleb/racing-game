import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import trackPreviews from '../src/ui/trackPreviews.json'
import { selectableCars } from '../src/vehicles/carRegistry'
import { TRACKS } from '../src/world/tracks'
import { practiceDatabase } from './helpers/practiceDatabase'
import { resultPlayers } from './helpers/resultRecord'

const [alice, bob] = resultPlayers
const carol = '10000000-0000-4000-8000-000000000003'
const BUILD = 'e0-tstreet-sstock-w0-b0'
const trial = (score: number, car = 'porsche911', track = 'nurburgring', build = BUILD) => ({ kind: 'trial', track, car, build, score })
const drift = (score: number, event = 'flow', track = 'drift-park') => ({ kind: 'drift', track, event, score })
interface Row { rank: number; entrants: number; display_name: string; car_id: string; score: number; is_me: boolean }

let db: PGlite
beforeAll(async () => { db = await practiceDatabase() }, 30_000)
afterAll(async () => { await db?.close() })
beforeEach(async () => { await db.exec('truncate public.leaderboard_scores') })

async function as<T>(player: string | null, action: () => Promise<T>): Promise<T> {
  await db.exec(`set role ${player ? 'authenticated' : 'anon'}`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [player ?? ''])
  try { return await action() } finally { await db.exec('reset role') }
}
const submit = async (player: string | null, entries: unknown) =>
  (await as(player, () => db.query<{ r: { accepted: number; rejected: number } }>('select public.submit_leaderboard_scores($1::jsonb) as r', [JSON.stringify(entries)]))).rows[0].r
const top = async (player: string | null, board: string, car: string | null = null) =>
  (await as(player, () => db.query<Row>('select * from public.leaderboard_top($1, $2)', [board, car]))).rows.map((r) => ({ ...r, rank: Number(r.rank), entrants: Number(r.entrants) }))

it('ranks laps fastest first and scores highest first, from any reader', async () => {
  await submit(alice, [trial(120_000), drift(5000)])
  await submit(bob, [trial(110_000), drift(9000)])
  const laps = await top(null, 'trial:nurburgring')
  expect(laps.map((r) => [r.rank, r.display_name, r.score, r.is_me])).toEqual([[1, 'Racer 1', 110_000, false], [2, 'Racer 0', 120_000, false]])
  expect(laps[0].entrants).toBe(2)
  expect((await top(alice, 'drift:drift-park:flow')).map((r) => [r.display_name, r.score, r.is_me])).toEqual([['Racer 1', 9000, false], ['Racer 0', 5000, true]])
})

it('only ever improves a score', async () => {
  await submit(alice, [trial(100_000), drift(5000)])
  await submit(alice, [trial(130_000), drift(100)])
  expect((await top(alice, 'trial:nurburgring'))[0].score).toBe(100_000)
  expect((await top(alice, 'drift:drift-park:flow'))[0].score).toBe(5000)
  await submit(alice, [trial(90_000), drift(6000)])
  expect((await top(alice, 'trial:nurburgring'))[0].score).toBe(90_000)
  expect((await top(alice, 'drift:drift-park:flow'))[0].score).toBe(6000)
})

it('counts a player once across cars, on their best; a car filter shows that car', async () => {
  await submit(alice, [trial(100_000, 'porsche911'), trial(90_000, 'koenigsegg')])
  await submit(bob, [trial(95_000, 'porsche911')])
  expect((await top(null, 'trial:nurburgring')).map((r) => [r.display_name, r.car_id, r.score])).toEqual([['Racer 0', 'koenigsegg', 90_000], ['Racer 1', 'porsche911', 95_000]])
  expect((await top(null, 'trial:nurburgring', 'porsche911')).map((r) => [r.display_name, r.score])).toEqual([['Racer 1', 95_000], ['Racer 0', 100_000]])
})

it('equal scores: first to set it leads', async () => {
  await submit(bob, [trial(100_000)])
  await submit(alice, [trial(100_000)])
  expect((await top(null, 'trial:nurburgring')).map((r) => r.display_name)).toEqual(['Racer 1', 'Racer 0'])
})

it('returns the top 50 plus the caller further down, and no ids or handles', async () => {
  await db.exec('alter table public.leaderboard_scores disable trigger all')
  await db.query(`insert into public.leaderboard_scores(board, player_id, car_id, build_key, score)
    select 'trial:nurburgring', p.id, 'porsche911', '${BUILD}', 200000 from public.profiles p`)
  for (let i = 0; i < 60; i++) {
    const id = `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    await db.query('insert into auth.users(id) values ($1)', [id])
    await db.query('insert into public.profiles(id, handle, display_name) values ($1, $2, $3)', [id, `filler_${i}`, `Filler ${i}`])
    await db.query(`insert into public.leaderboard_scores(board, player_id, car_id, build_key, score) values ('trial:nurburgring', $1, 'porsche911', '${BUILD}', $2)`, [id, 100_000 + i])
  }
  await db.exec('alter table public.leaderboard_scores enable trigger all')
  const guest = await top(null, 'trial:nurburgring')
  expect(guest).toHaveLength(50)
  expect(guest[0].entrants).toBe(62)
  const mine = await top(alice, 'trial:nurburgring')
  expect(mine).toHaveLength(51)
  expect(mine[50]).toMatchObject({ is_me: true, display_name: 'Racer 0' })
  expect(mine[50].rank).toBeGreaterThan(60)
  expect(Object.keys(mine[0]).sort()).toEqual(['build_key', 'car_id', 'display_name', 'entrants', 'is_me', 'rank', 'score', 'set_at'])
  await db.exec(`delete from public.profiles where handle like 'filler_%'`)
})

it('skips bad entries without losing the good ones', async () => {
  const result = await submit(alice, [
    trial(100_000),
    trial(1000), // Under the track's floor.
    trial(100_000, 'hovercraft'),
    trial(100_000, 'porsche911', 'atlantis'),
    trial(100_000, 'koenigsegg', 'nurburgring', 'turbo'),
    trial(4_000_000, 'bmw'),
    { ...trial(100_000, 'bmw'), score: '100000' },
    { ...trial(100_000, 'bmw'), score: 100_000.5 },
    drift(20_000_000),
    drift(100, 'nope'),
    { kind: 'race', track: 'nurburgring', score: 1000 },
    null,
  ])
  expect(result).toEqual({ accepted: 1, rejected: 11 })
  expect(await top(alice, 'trial:nurburgring')).toHaveLength(1)
})

it('takes the player from auth only, and requires a racer profile', async () => {
  await expect(submit(null, [trial(100_000)])).rejects.toThrow()
  await submit(alice, [{ ...trial(100_000), player_id: bob }])
  expect((await top(bob, 'trial:nurburgring'))[0]).toMatchObject({ display_name: 'Racer 0', is_me: false })
  await db.query('insert into auth.users(id) values ($1)', [carol])
  await expect(submit(carol, [trial(100_000)])).rejects.toThrow('racer_profile_required')
  await expect(submit(alice, Array.from({ length: 65 }, () => trial(100_000)))).rejects.toThrow('invalid_leaderboard_batch')
})

it('gives no role direct access to the table, and anon no write', async () => {
  for (const role of ['anon', 'authenticated'] as const) {
    await db.exec(`set role ${role}`)
    try {
      await expect(db.query('select * from public.leaderboard_scores')).rejects.toMatchObject({ code: '42501' })
      await expect(db.query(`insert into public.leaderboard_scores(board, player_id, car_id, build_key, score) values ('trial:city', '${alice}', 'bmw', '${BUILD}', 1)`)).rejects.toMatchObject({ code: '42501' })
    } finally { await db.exec('reset role') }
  }
  await db.exec('set role anon')
  try {
    await expect(db.query(`select public.submit_leaderboard_scores('[]'::jsonb)`)).rejects.toMatchObject({ code: '42501' })
  } finally { await db.exec('reset role') }
})

it('removes a deleted racer from the board', async () => {
  const id = '40000000-0000-4000-8000-000000000001'
  await db.query('insert into auth.users(id) values ($1)', [id])
  await db.query(`insert into public.profiles(id, handle, display_name) values ($1, 'leaver', 'Leaver')`, [id])
  await submit(id, [trial(100_000)])
  expect(await top(null, 'trial:nurburgring')).toHaveLength(1)
  await db.query('delete from public.profiles where id = $1', [id])
  expect(await top(null, 'trial:nurburgring')).toHaveLength(0)
})

// The migration has its own lists: a new car or circuit has to be added there too.
it('accepts every circuit and car in the game, with a floor no real lap can beat', async () => {
  for (const track of TRACKS) {
    const floor = Number((trackPreviews as Record<string, { lengthKm: string }>)[track.id].lengthKm) * 1000 / 150 * 1000
    expect(await submit(alice, [trial(Math.ceil(floor * 1.02), 'porsche911', track.id), drift(100, 'flow', track.id)]), track.id).toEqual({ accepted: 2, rejected: 0 })
  }
  for (const car of selectableCars()) expect(await submit(alice, [trial(100_000, car.id)]), car.id).toEqual({ accepted: 1, rejected: 0 })
})
