import { afterAll, beforeAll, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { practiceDatabase } from './helpers/practiceDatabase'
import { resultPlayers } from './helpers/resultRecord'
let db: PGlite
beforeAll(async () => { db = await practiceDatabase() }, 30_000)
afterAll(async () => { await db?.close() })
async function role(name: 'anon' | 'authenticated' | 'service_role', player: string, action: () => Promise<void>) {
  await db.exec(`set role ${name}`)
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [player])
  try { await action() } finally { await db.exec('reset role') }
}
const save = (handle: string, name: string) => db.query('select * from public.save_racer_profile($1,$2)', [handle,name])
it('records each real handle/display change, including returning to an old handle, without a cooldown', async () => {
  await role('authenticated', resultPlayers[0], async () => {
    await save('nightshift_7', 'Night Shift')
    await save('apex_runner', 'Night Shift')
    await save('apex_runner', 'Nürburgring Racer')
    await save('nightshift_7', 'Night Shift')
    await save(' NIGHTSHIFT_7 ', 'Night Shift') // canonical no-op, not a rename
    const rows = (await db.query('select * from public.my_racer_identity_history()')).rows
    expect(rows).toHaveLength(5) // original fixture creation + four real changes
    // Wall-clock timestamps can tie; the UUID tie-breaker is stable, not rename order.
    expect(rows.map(r => [r.kind,r.old_handle,r.new_handle,r.new_display_name])).toEqual(expect.arrayContaining([
      ['renamed','apex_runner','nightshift_7','Night Shift'],
      ['renamed','apex_runner','apex_runner','Nürburgring Racer'],
      ['renamed','nightshift_7','apex_runner','Night Shift'],
      ['renamed','racer_0','nightshift_7','Night Shift'],
      ['created',null,'racer_0','Racer 0'],
    ]))
    await expect(save('admin','Admin')).rejects.toMatchObject({ code: '22023' })
    expect((await db.query('select * from public.my_racer_identity_history()')).rows).toHaveLength(5)
  })
  await role('authenticated', resultPlayers[1], async () => {
    await expect(save('apex_runner','Apex')).rejects.toMatchObject({ code: '23505' })
    expect((await db.query('select * from public.my_racer_identity_history()')).rows).toHaveLength(1)
  })
})
it('keeps the profile write, reservation and audit event in the same transaction', async () => {
  const before = (await db.query('select * from public.racer_identity_events')).rows.length
  await db.exec('begin')
  try {
    await role('authenticated', resultPlayers[0], async () => { await save('rollback_racer','Rollback Racer') })
    expect((await db.query('select * from public.racer_identity_events')).rows).toHaveLength(before+1)
  } finally { await db.exec('rollback') }
  expect((await db.query('select * from public.racer_identity_events')).rows).toHaveLength(before)
  expect((await db.query("select * from public.username_history where handle='rollback_racer'")).rows).toEqual([])
  expect((await db.query('select handle from public.profiles where id=$1',[resultPlayers[0]])).rows[0].handle).toBe('nightshift_7')
})
it('allows only owner reads and denies direct insertion, rewriting, deletion and trigger execution', async () => {
  await role('authenticated', resultPlayers[1], async () => {
    const rows = (await db.query('select * from public.racer_identity_events')).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].player_id).toBe(resultPlayers[1])
    expect((await db.query('select * from public.racer_identity_events where player_id=$1',[resultPlayers[0]])).rows).toEqual([])
    for (const statement of [
      "insert into public.racer_identity_events(player_id,kind,new_handle,new_display_name) values(auth.uid(),'created','forged_name','Forged Name')",
      "update public.racer_identity_events set new_handle='forged_name'",
      'delete from public.racer_identity_events', 'select public.audit_racer_identity()',
    ]) await expect(db.exec(statement)).rejects.toMatchObject({ code: '42501' })
  })
  for (const name of ['anon','service_role'] as const) await role(name, resultPlayers[0], async () => {
    await expect(db.exec('select * from public.my_racer_identity_history()')).rejects.toMatchObject({ code: '42501' })
    await expect(db.exec('select * from public.racer_identity_events')).rejects.toMatchObject({ code: '42501' })
  })
})
it('uses a bounded stable cursor for same-timestamp events and rejects half cursors', async () => {
  await role('authenticated', resultPlayers[0], async () => {
    for (let i=0;i<25;i++) await save('nightshift_7',`Racer ${i}`)
  })
  await db.exec("update public.racer_identity_events set recorded_at='2026-10-23T12:00:00Z'")
  await role('authenticated', resultPlayers[0], async () => {
    const first = (await db.query('select * from public.my_racer_identity_history()')).rows
    expect(first).toHaveLength(21)
    const firstIds = first.map(r => r.event_id as string)
    expect(firstIds).toEqual([...firstIds].sort().reverse())
    const last = first[19]
    const rest = (await db.query('select * from public.my_racer_identity_history($1,$2)',[last.recorded_at,last.event_id])).rows
    expect(rest).toHaveLength(10)
    expect(new Set([...first.slice(0,20),...rest].map(r=>r.event_id)).size).toBe(30)
    await expect(db.query('select * from public.my_racer_identity_history($1,null)',[last.recorded_at])).rejects.toMatchObject({ code: '22023' })
  })
})
it('backfills a truthful baseline without inventing historic rename events', async () => {
  // Apply the audit migration to an independently bootstrapped pre-audit project.
  const { PGlite } = await import('@electric-sql/pglite')
  const legacy = await PGlite.create()
  try {
    await legacy.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select '${resultPlayers[0]}'::uuid $$;`)
    await legacy.exec(await readFile(new URL('../supabase/migrations/0002_racer_profiles.sql',import.meta.url),'utf8'))
    await legacy.query('insert into auth.users values($1)',[resultPlayers[0]])
    await legacy.query("insert into public.profiles(id,handle,display_name) values($1,'existing_racer','Existing Racer')",[resultPlayers[0]])
    await legacy.exec(await readFile(new URL('../supabase/migrations/0005_racer_identity_audit.sql',import.meta.url),'utf8'))
    const rows=(await legacy.query('select kind,old_handle,new_handle from public.racer_identity_events')).rows
    expect(rows).toEqual([{kind:'baseline',old_handle:null,new_handle:'existing_racer'}])
    await legacy.exec("select public.save_racer_profile('renamed_existing','New Name')")
    const kinds = (await legacy.query('select kind from public.racer_identity_events')).rows
    expect(kinds).toHaveLength(2)
    expect(kinds).toEqual(expect.arrayContaining([{kind:'baseline'},{kind:'renamed'}]))
    await legacy.query('delete from auth.users where id=$1',[resultPlayers[0]])
    expect((await legacy.query('select * from public.racer_identity_events')).rows).toEqual([])
  } finally { await legacy.close() }
})
