import { createClient } from '@supabase/supabase-js'
import { decodeJwt } from 'jose'
import { RejectedResult, type ResultWriter } from './ResultOutbox.js'

/** Optional server-only credential. Never reuse a player's bearer token to write results. */
export function supabaseResultWriter(url: string, key: string): ResultWriter {
  const endpoint = new URL(url)
  if (endpoint.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Result storage must use HTTPS')
  let privileged = key.startsWith('sb_secret_')
  try { privileged ||= decodeJwt(key).role === 'service_role' } catch { /* Modern keys are not JWTs. */ }
  if (!privileged) throw new Error('Result storage requires a server-only secret key')
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) },
  })
  return async record => {
    const { data, error } = await client.rpc('record_online_practice', { race_record: record })
    if (error) {
      // Schema/config/network outages remain pending. Invalid/conflicting records need inspection.
      if ((error.code ?? '').startsWith('22') || ['23505', '23503', '23514'].includes(error.code)) throw new RejectedResult('Database rejected result')
      throw new Error('Result storage unavailable')
    }
    if (!data || data.raceId !== record.result.raceId || typeof data.savedAt !== 'string' || !Number.isFinite(Date.parse(data.savedAt))) throw new Error('Invalid result storage response')
    return { raceId: data.raceId, savedAt: data.savedAt }
  }
}
