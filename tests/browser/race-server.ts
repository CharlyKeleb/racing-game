// Test-only backend. Not imported by either server entrypoint or included in its image.
import { readFile } from 'node:fs/promises'
import { createBackend } from '../../server/src/server'
import { AdmissionError } from '../../server/src/auth'
import { createRaceFactory, type SimulationBundle } from '../../scripts/multiplayer/race-factory'
import { scriptedRaceFactory } from '../helpers/scriptedRaceFactory'
import { initRapier } from '../../src/engine/PhysicsWorld'
await initRapier()
const bundle = JSON.parse(await readFile(new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url), 'utf8')) as SimulationBundle
const raceFactory = process.argv.includes('--scripted-results') ? { ...scriptedRaceFactory(), fingerprint: bundle.fingerprint } : createRaceFactory(bundle)
const backend = createBackend({ origins: ['http://127.0.0.1:5174'], maxRooms: 5, raceFactory, authenticate: async token => {
  if (!/^smoke-(one|two)$/.test(token)) throw new AdmissionError(401, 'This test server accepts only its synthetic racers')
  return { id: token, handle: token.replace('-', '_'), displayName: token.replace('-', ' '), expiresAt: Date.now() + 3600_000 }
} })
await backend.listen(2569, '127.0.0.1')
console.info(`Synthetic browser fixture listening on 127.0.0.1:2569 (${process.argv.includes('--scripted-results') ? 'scripted results, no physics' : 'shipped physics'})`)
process.on('SIGINT', () => { void backend.gameServer.gracefullyShutdown(false).then(() => process.exit(0)) })
