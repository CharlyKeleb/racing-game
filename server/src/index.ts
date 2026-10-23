import { createBackend } from './server.js'
import { supabaseAuthenticator } from './auth.js'
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALLOWED_ORIGINS } = process.env
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !ALLOWED_ORIGINS) throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and ALLOWED_ORIGINS.')
const url = new URL(SUPABASE_URL)
if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('Supabase must use HTTPS.')
const backend = createBackend({ authenticate: supabaseAuthenticator(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY), origins: ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) })
await backend.listen(Number(process.env.PORT || 2567))
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  const deadline = setTimeout(() => process.exit(1), 20_000)
  deadline.unref()
  const report = await backend.shutdown(15_000)
  console.info('Multiplayer shutdown', report)
  clearTimeout(deadline)
  process.exit(report.pendingResultWrites ? 1 : 0)
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
console.info('Multiplayer lobby server ready')
