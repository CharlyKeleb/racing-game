// Server-only preflight. The deliberately invalid payload cannot create a race record.
import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute } from 'node:path'
import { supabaseResultWriter } from '../../server/src/supabaseResultWriter'
import { RejectedResult } from '../../server/src/ResultOutbox'
import type { ResultRecord } from '../../server/src/ResultRecord'
const { SUPABASE_URL, SUPABASE_RESULT_SECRET_KEY, RESULT_OUTBOX_DIR } = process.env
if (!SUPABASE_URL || !SUPABASE_RESULT_SECRET_KEY || !RESULT_OUTBOX_DIR || !isAbsolute(RESULT_OUTBOX_DIR)) {
  throw new Error('Configure the server result writer and absolute outbox directory')
}
const directory = await stat(RESULT_OUTBOX_DIR)
if (!directory.isDirectory() || (directory.mode & 0o777) !== 0o700) throw new Error('Result outbox must be a private 0700 directory')
await access(RESULT_OUTBOX_DIR, constants.R_OK | constants.W_OK)
const writer = supabaseResultWriter(SUPABASE_URL, SUPABASE_RESULT_SECRET_KEY)
let rejected = false
try { await writer({} as ResultRecord) }
catch (error) {
  if (!(error instanceof RejectedResult)) throw new Error('Server result RPC preflight failed; check server configuration')
  rejected = true
}
if (!rejected) throw new Error('Invalid result was unexpectedly accepted')
console.info(JSON.stringify({ check: 'server-result-storage', rpcValidationReached: true, invalidRecordRejected: true,
  newRecordsWritten: 0, privateWritableOutbox: true }))
