import { afterEach, expect, it, vi } from 'vitest'
import { supabaseResultWriter } from '../server/src/supabaseResultWriter'
import { RejectedResult } from '../server/src/ResultOutbox'
import { savedRace } from './helpers/resultRecord'
afterEach(() => vi.unstubAllGlobals())
const key = 'sb_secret_test_only'
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
it('requires a server-only key and HTTPS', () => {
  expect(() => supabaseResultWriter('https://example.supabase.co', 'sb_publishable_nope')).toThrow('server-only')
  expect(() => supabaseResultWriter('http://example.com', key)).toThrow('HTTPS')
})
it('submits only the trusted RPC payload with a deadline and requires a matching commit receipt', async () => {
  const record = savedRace(), receipt = { raceId: record.result.raceId, savedAt: '2026-10-23T17:00:00Z' }
  const fetch = vi.fn().mockResolvedValueOnce(response(receipt)).mockResolvedValueOnce(response({ ...receipt, raceId: 'other' }))
  vi.stubGlobal('fetch', fetch)
  const save = supabaseResultWriter('https://example.supabase.co', key)
  await expect(save(record)).resolves.toEqual(receipt)
  const [url, init] = fetch.mock.calls[0]
  expect(String(url)).toBe('https://example.supabase.co/rest/v1/rpc/record_online_practice')
  expect(JSON.parse(init.body)).toEqual({ race_record: record })
  expect(init.signal).toBeInstanceOf(AbortSignal)
  await expect(save(record)).rejects.toThrow('response')
})
it('retries outages/config failures but quarantines invalid/conflicting records without exposing DB details', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const save = supabaseResultWriter('https://example.supabase.co', key)
  for (const code of ['22023', '23505', '23503']) {
    fetch.mockResolvedValueOnce(response({ code, message: 'private database details' }, 400))
    await expect(save(savedRace())).rejects.toBeInstanceOf(RejectedResult)
  }
  for (const code of ['PGRST202', '42501', '08006', '']) {
    fetch.mockResolvedValueOnce(response({ code, message: 'private database details' }, 503))
    await expect(save(savedRace())).rejects.toThrow('Result storage unavailable')
  }
})
