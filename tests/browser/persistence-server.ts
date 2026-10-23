// Disposable synthetic DB fixture. Never imported by a shipped entrypoint or image.
import { createServer } from 'node:http'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createBackend } from '../../server/src/server'
import { AdmissionError } from '../../server/src/auth'
import { ResultOutbox } from '../../server/src/ResultOutbox'
import { practiceDatabase } from '../helpers/practiceDatabase'
import { resultPlayers } from '../helpers/resultRecord'
import { scriptedRaceFactory } from '../helpers/scriptedRaceFactory'
const db = await practiceDatabase()
const directory = await mkdtemp(join(tmpdir(), 'racing-browser-persistence-'))
const outbox = await ResultOutbox.open(directory, async record => {
  const saved = await db.query<{ receipt: { raceId: string; savedAt: string } }>('select public.record_online_practice($1::jsonb) as receipt', [JSON.stringify(record)])
  return saved.rows[0].receipt
})
const bundle = JSON.parse(await readFile(new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url), 'utf8'))
const backend = createBackend({ origins: ['http://127.0.0.1:5174'], maxRooms: 5, resultPersistence: outbox,
  raceFactory: { ...scriptedRaceFactory(), fingerprint: bundle.fingerprint }, authenticate: async token => {
    if (!/^smoke-(one|two)$/.test(token)) throw new AdmissionError(401, 'Synthetic fixture racers only')
    return { id: resultPlayers[token === 'smoke-one' ? 0 : 1], handle: token.replace('-', '_'), displayName: token.replace('-', ' '), expiresAt: Date.now() + 3600_000 }
  } })
// The browser fixture uses this read-only owner endpoint to populate the real history UI.
// Hosted Supabase Auth/PostgREST and CloudSave integration remain separate acceptance tests.
const history = createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.headers.origin !== 'http://127.0.0.1:5174') { res.writeHead(403).end(); return }
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5174')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }
  const token = req.headers.authorization?.match(/^Bearer smoke-(one|two)$/)?.[1]
  if (req.method !== 'GET' || req.url !== '/history' || !token) { res.writeHead(403).end(); return }
  void db.transaction(async tx => {
    await tx.exec('set local role authenticated')
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [resultPlayers[token === 'one' ? 0 : 1]])
    const rows = await tx.query('select * from public.my_online_practice_history()')
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(rows.rows))
  }).catch(() => { if (!res.headersSent) res.writeHead(503); res.end() })
})
await new Promise<void>(resolve => history.listen(2570, '127.0.0.1', resolve))
await backend.listen(2569, '127.0.0.1')
console.info('Synthetic scripted results + embedded Postgres: 127.0.0.1:2569 / history:2570. No real accounts or physical lap completion.')
process.on('SIGINT', () => { void (async () => {
  await backend.gameServer.gracefullyShutdown(false)
  await outbox.close()
  await new Promise<void>(resolve => history.close(() => resolve()))
  await db.close(); await rm(directory, { recursive: true, force: true })
  process.exit(0)
})() })
