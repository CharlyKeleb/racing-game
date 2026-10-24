// Separate root-context build; server/src/index.ts remains the lobby-only pilot.
import { readFile } from 'node:fs/promises'
import { practiceConfig } from '../../server/src/PracticeConfig'
import { consoleMetrics } from '../../server/src/MultiplayerMetrics'
import { createBackend } from '../../server/src/server'
import { supabaseAuthenticator } from '../../server/src/auth'
import { ResultOutbox } from '../../server/src/ResultOutbox'
import { supabaseResultWriter } from '../../server/src/supabaseResultWriter'
import { initRapier } from '../../src/engine/PhysicsWorld'
import { createRaceFactory, type SimulationBundle } from './race-factory'
import { decodeSimulationBundle } from './compact-assets'

const config = practiceConfig(process.env)
const bundle: SimulationBundle = decodeSimulationBundle(await readFile(config.assetFile))
await initRapier()
const raceFactory = createRaceFactory(bundle, { scheduledInputs: config.scheduledInputs })
if (process.argv.length > 2 && (process.argv.length !== 3 || process.argv[2] !== '--check-assets')) throw new Error('Unsupported practice server arguments')
if (process.argv[2] === '--check-assets') {
  const simulation = await raceFactory.create([{ id: 'check-one', sessionId: 'check-one', carId: 'porsche911' },
    { id: 'check-two', sessionId: 'check-two', carId: 'bmw' }])
  try {
    for (let tick = 0; tick < 12; tick++) simulation.step()
    const states = simulation.states()
    if (states.length !== 2 || states.some(state => ![state.position.x, state.position.y, state.position.z, state.rpm].every(Number.isFinite))) throw new Error('Invalid packaged simulation state')
    const memory = process.memoryUsage()
    console.info(JSON.stringify({ check: 'practice-assets', fingerprint: bundle.fingerprint, racers: states.length, ticks: 12,
      correctionVersion: raceFactory.correctionVersion, scheduledInputVersion: raceFactory.scheduledInputVersion ?? null,
      memoryAfterWorldSteps: { rssMiB: memory.rss / 1024 / 1024, heapUsedMiB: memory.heapUsed / 1024 / 1024,
        externalMiB: memory.external / 1024 / 1024 } }))
  } finally { simulation.dispose() }
} else {
  await serve()
}

async function serve() {
  const resultPersistence = config.resultStorage
    ? await ResultOutbox.open(config.resultStorage.directory, supabaseResultWriter(config.supabaseUrl, config.resultStorage.key)) : undefined
  const backend = createBackend({ authenticate: supabaseAuthenticator(config.supabaseUrl, config.publishableKey), origins: config.origins,
    raceFactory, resultPersistence, maxRooms: 1, metrics: consoleMetrics(process.env.MULTIPLAYER_METRICS) })
  let stopping = false
  async function stop() {
    if (stopping) return
    stopping = true
    const deadline = setTimeout(() => process.exit(1), 20_000)
    deadline.unref()
    try {
      const report = await backend.shutdown(15_000)
      await resultPersistence?.close()
      console.info('Practice shutdown', report)
      clearTimeout(deadline)
      process.exit(report.pendingResultWrites ? 1 : 0)
    } catch { console.error('Practice shutdown did not complete'); process.exit(1) }
  }
  process.on('SIGTERM', () => void stop())
  process.on('SIGINT', () => void stop())
  try {
    await backend.listen(config.port, '0.0.0.0')
    console.info('Isolated practice server ready', { fingerprint: bundle.fingerprint, maximumRooms: 1, maximumRacers: 2,
      scheduledInputs: config.scheduledInputs, resultStorage: !!resultPersistence })
  } catch {
    await resultPersistence?.close()
    throw new Error('Practice server could not listen')
  }
}
