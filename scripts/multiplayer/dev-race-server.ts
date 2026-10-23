// Explicit local-only runner. Production server/src/index.ts remains lobby-only.
import { initRapier } from '../../src/engine/PhysicsWorld'
import { readFile } from 'node:fs/promises'
import { createBackend } from '../../server/src/server'
import { supabaseAuthenticator } from '../../server/src/auth'
import { createRaceFactory, type SimulationBundle } from './race-factory'

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, ALLOWED_ORIGINS } = process.env
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !ALLOWED_ORIGINS) throw new Error('Set Supabase configuration and explicit allowed origins in server/.env.local')
const authUrl = new URL(SUPABASE_URL)
if (authUrl.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(authUrl.hostname)) throw new Error('Supabase must use HTTPS.')
await initRapier()
const bundle = JSON.parse(await readFile(new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url), 'utf8')) as SimulationBundle
const backend = createBackend({ authenticate: supabaseAuthenticator(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY),
  origins: ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean), raceFactory: createRaceFactory(bundle), maxRooms: 5 })
await backend.listen(2568, '127.0.0.1')
console.info('Local development race transport listening on 127.0.0.1:2568; one two-racer simulation maximum')
let stopping = false
async function stop() {
  if (stopping) return
  stopping = true
  backend.drain()
  const deadline = setTimeout(() => process.exit(1), 20_000)
  deadline.unref()
  await backend.gameServer.gracefullyShutdown(false)
  clearTimeout(deadline)
  process.exit(0)
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
