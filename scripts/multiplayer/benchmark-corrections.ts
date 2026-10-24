// Offline cost measurement, not a transport, scheduler or hosted capacity benchmark.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { arch, cpus, platform } from 'node:os'
import { performance } from 'node:perf_hooks'
import { RaceSession, SERVER_TICK_MS } from '../../server/src/RaceSession'
import { CORRECTION_INTERVAL_TICKS, MAX_CORRECTION_BYTES } from '../../server/src/protocol'
import { createRaceFactory, type SimulationBundle } from './race-factory'
import { decodeCorrectionJson, type CorrectionBinding } from '../../src/multiplayer/CorrectionState'
import { resolveVehicleConfig } from '../../src/vehicles/VehicleConfig'
import { AiDriver } from '../../src/racing/AiDriver'
import { peakSlipAngle } from '../../src/vehicles/TirePhysics'

const seconds = Number(process.argv[2] ?? 30)
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120) throw new Error('Usage: benchmark-corrections.ts [5-120 simulated racing seconds]')
const bundle = JSON.parse(await readFile(new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url), 'utf8')) as SimulationBundle
const config = resolveVehicleConfig(bundle.cars.porsche911), factory = createRaceFactory(bundle, { scheduledInputs: true })
const racers = ['one', 'two'].map((id, index) => ({ id, sessionId: `seat-${index}`, carId: 'porsche911' as const }))
const race = new RaceSession(racers, factory, 10)
const stepMs: number[] = [], encodeMs: number[] = [], decodeMs: number[] = [], sizes: number[] = [], publicSizes: number[] = []
const zs = config.wheels.map(wheel => wheel.position[2])
const drivers = racers.map(() => new AiDriver(bundle.track.line, { wheelbase: Math.max(...zs) - Math.min(...zs), maxSteerAngle: config.maxSteerAngle,
  steerFalloffSpeed: config.steerFalloffSpeed, arcade: config.arcade, grip: config.tires.grip, peakSlip: peakSlipAngle(config.tires),
  steerPeakSlipScale: config.steerPeakSlipScale, downforcePerKg: config.downforceCoefficient / config.massKg, brakeDecel: config.brakeForce / config.massKg }, .8))
const bindings: CorrectionBinding[] = racers.map(racer => ({ raceId: race.descriptor.id, racerId: racer.id, carId: racer.carId,
  fingerprint: bundle.fingerprint, simulationVersion: factory.simulationVersion, afterTick: -1, acknowledgedSequence: -1, maximumSentSequence: -1, config }))
const distances = [0, 0], sequence = [0, 0], totalBytes = [0, 0], lastPosition: ({ x: number; z: number } | undefined)[] = []
let peakRss = 0
function percentiles(values: number[]) {
  const ordered = values.slice().sort((a, b) => a - b)
  if (!ordered.length) throw new Error('Empty benchmark sample')
  const at = (fraction: number) => ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * fraction))]
  return { count: ordered.length, p50: at(.5), p95: at(.95), p99: at(.99), max: ordered[ordered.length - 1] }
}
try {
  await race.load(factory)
  for (const racer of racers) race.acknowledge(racer.sessionId, { protocol: 3, raceId: race.descriptor.id,
    fingerprint: bundle.fingerprint, simulationVersion: factory.simulationVersion })
  for (let tick = 0; tick < 180; tick++) race.advance(SERVER_TICK_MS)
  if (race.phase !== 'racing') throw new Error('Race did not load')
  let frame = race.snapshot()!
  const cpuStart = process.cpuUsage(), started = performance.now()
  for (let tick = 0; tick < seconds * 60; tick++) {
    const stepStart = performance.now()
    for (let i = 0; i < racers.length; i++) {
      const state = frame.vehicles.find(vehicle => vehicle.id === racers[i].id)!, p = state.position, q = state.rotation
      const driver = drivers[i]
      const controls = driver.update(1 / 60, { x: p.x, z: p.z, speed: state.speed,
        heading: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) }, [], i, 0, 0)
      const centre = bundle.track.line[driver.progress.index]
      if (![p.x, p.y, p.z].every(Number.isFinite) || Math.abs(p.y - centre.y) > 15 || driver.needsRecovery) throw new Error('Benchmark left drivable course')
      const previous = lastPosition[i]
      if (previous) distances[i] += Math.hypot(p.x - previous.x, p.z - previous.z)
      lastPosition[i] = { x: p.x, z: p.z }
      bindings[i].maximumSentSequence = sequence[i]++
      if (!race.scheduledInput(racers[i].sessionId, { ...controls, version: 1, tick: race.tick + 1, raceId: race.descriptor.id,
        sequence: bindings[i].maximumSentSequence }, tick * SERVER_TICK_MS)) throw new Error('Scheduled benchmark input rejected')
    }
    race.advance(SERVER_TICK_MS)
    if (race.phase !== 'racing' || race.tick !== tick + 181) throw new Error('Benchmark clock or lifecycle changed')
    if (race.tick % 3 === 0) { frame = race.snapshot()!; publicSizes.push(Buffer.byteLength(JSON.stringify(frame))) }
    // Decode is a browser cost: subtract its duration from the server-work sample.
    let decoderWork = 0
    if (race.tick % CORRECTION_INTERVAL_TICKS === 0) for (let i = 0; i < racers.length; i++) {
      const captureAt = performance.now(), json = race.correction(racers[i].sessionId)
      encodeMs.push(performance.now() - captureAt)
      if (!json) throw new Error('Missing correction')
      const bytes = Buffer.byteLength(json)
      if (bytes > MAX_CORRECTION_BYTES) throw new Error('Oversized correction')
      sizes.push(bytes); totalBytes[i] += bytes
      const decodeAt = performance.now(), decoded = decodeCorrectionJson(json, bindings[i])
      const duration = performance.now() - decodeAt
      decodeMs.push(duration); decoderWork += duration
      if (!decoded || decoded.tick !== race.tick || decoded.acknowledgedSequence !== bindings[i].maximumSentSequence) throw new Error('Invalid/unacknowledged correction')
      bindings[i].afterTick = decoded.tick; bindings[i].acknowledgedSequence = decoded.acknowledgedSequence
    }
    stepMs.push(performance.now() - stepStart - decoderWork)
    if (tick % 60 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss / 1024 / 1024)
  }
  const elapsedMs = performance.now() - started, cpu = process.cpuUsage(cpuStart)
  if (sizes.length !== seconds * 20 || distances.some(distance => distance < seconds * 5)) throw new Error('Incomplete or stationary benchmark')
  const sourceHash = createHash('sha256')
  for (const file of ['scripts/multiplayer/benchmark-corrections.ts', 'scripts/multiplayer/race-factory.ts', 'server/src/RaceSession.ts',
    'server/src/ScheduledInputs.ts', 'server/src/RaceProgress.ts', 'server/src/protocol.ts', 'src/multiplayer/CorrectionState.ts']) {
    sourceHash.update(file).update('\0').update(await readFile(new URL(`../../${file}`, import.meta.url))).update('\0')
  }
  const report = { schema: 1, recordedAt: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirtyWorktree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).length > 0, benchmarkSourceSha256: sourceHash.digest('hex'),
    fingerprint: bundle.fingerprint, simulationVersion: factory.simulationVersion, raceProtocol: 3,
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    racers: 2, simulatedSeconds: seconds, measuredTicks: stepMs.length, elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000,
    serverAndHarnessTickMs: percentiles(stepMs), correctionEncodeMs: percentiles(encodeMs), correctionDecodeMs: percentiles(decodeMs),
    correctionBytes: percentiles(sizes), publicSnapshotBytes: percentiles(publicSizes),
    privateJsonBytesPerSimulatedSecondPerRacer: totalBytes.map(bytes => bytes / seconds), sampledPeakRssMiB: peakRss,
    distanceMetres: distances.map(Math.round),
    scope: 'Local unpaced real-track AI/session/scheduled-input/public JSON/private correction capture and browser decoder measurement. Server sample includes AI/harness work and excludes decoder time. CPU/RSS include the entire development process. No sockets, scheduling, renderer/prediction world, database, container, network timing or Fly capacity claim.' }
  await mkdir(new URL('../../.cache/multiplayer/', import.meta.url), { recursive: true })
  await writeFile(new URL('../../.cache/multiplayer/benchmark-corrections.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
  console.info(JSON.stringify(report, null, 2))
} finally { race.close('Benchmark finished') }
