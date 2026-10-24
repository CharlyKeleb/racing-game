import { expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { practiceDatabase } from './helpers/practiceDatabase'

it('executes the linked acceptance SQL and rolls all synthetic data back', async () => {
  const db = await practiceDatabase()
  try {
    const before = await db.query('select count(*) from auth.users')
    const sql = await readFile(new URL('../supabase/tests/online_practice_acceptance.sql', import.meta.url), 'utf8')
    expect(sql.startsWith("\\set ON_ERROR_STOP on\n")).toBe(true)
    const results = await db.exec(sql.slice(sql.indexOf("\n") + 1))
    const tap = results.flatMap(result => result.rows).flatMap(row => Object.values(row)).filter(value => typeof value === 'string' && /^(1\.\.|ok )/.test(value))
    expect(tap).toEqual(['1..6',
      'ok 1 - backend saves retirement result and retries idempotently, rejects conflict',
      'ok 2 - both private rows and ineligible retirement metadata persist within transaction',
      'ok 3 - owner sees own race and audit but cannot see the other racer',
      'ok 4 - other racer isolated and browser writes/raw records denied',
      'ok 5 - anonymous history, audit and result-writing access denied',
      'ok 6 - backend is limited to result RPC, with direct mutation and audit access denied'])
    expect((await db.query('select count(*) from auth.users')).rows).toEqual(before.rows)
    expect((await db.query('select * from public.online_practice_races')).rows).toEqual([])
  } finally { await db.close() }
}, 30_000)
