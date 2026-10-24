// Local-only paced measurement. Never imported by a shipped backend/browser entrypoint.
import { Client, type Room } from '@colyseus/sdk'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { arch, cpus, platform } from 'node:os'
import { performance } from 'node:perf_hooks'
import { createBackend } from '../../server/src/server'
import { AdmissionError } from '../../server/src/auth'
import { RACE_PROTOCOL, type LobbySnapshot, type RaceSnapshot } from '../../server/src/protocol'
import { createRaceFactory, type SimulationBundle } from './race-factory'
import { AiDriver } from '../../src/racing/AiDriver'
import { peakSlipAngle } from '../../src/vehicles/TirePhysics'
import { resolveVehicleConfig } from '../../src/vehicles/VehicleConfig'

const seconds = Number(process.argv[2] ?? 30)
if (!Number.isInteger(seconds) || seconds < 5 || seconds > 120) throw new Error('Usage: benchmark-transport.ts [5-120 wall-clock racing seconds]')
const bundle = JSON.parse(await readFile(new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url), 'utf8')) as SimulationBundle
const factory = createRaceFactory(bundle)
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002']
const tokens = ['local-benchmark-one', 'local-benchmark-two']
// Warm startup work outside the measured session; warmed WASM still counts toward RSS.
const warm = await factory.create(ids.map((id, i) => ({ id, sessionId: `warm-${i}`, carId: 'porsche911' as const })))
warm.dispose()
let peakRssMiB = 0, peakHeapMiB = 0, measuring = false, failed: Error | null = null
const backend = createBackend({ origins: ['http://localhost:5173'], maxRooms: 1, raceFactory: factory,
  metrics: { intervalMs: 1000, report: report => {
    if (measuring) { peakRssMiB = Math.max(peakRssMiB, report.gauges.rssMiB); peakHeapMiB = Math.max(peakHeapMiB, report.gauges.heapUsedMiB) }
  } }, authenticate: async token => {
    const i = tokens.indexOf(token)
    if (i < 0) throw new AdmissionError(401, 'Synthetic local benchmark only')
    return { id: ids[i], handle: `benchmark_${i}`, displayName: `Benchmark ${i}`, expiresAt: Date.now() + 300_000 }
  } })
const clients: Room[] = [], lobbies: (LobbySnapshot | undefined)[] = [], frames: (RaceSnapshot | undefined)[] = []
const drivers = ids.map(() => {
  const config = resolveVehicleConfig(bundle.cars.porsche911), zs = config.wheels.map(w => w.position[2])
  return new AiDriver(bundle.track.line, { wheelbase: Math.max(...zs) - Math.min(...zs), maxSteerAngle: config.maxSteerAngle,
    steerFalloffSpeed: config.steerFalloffSpeed, arcade: config.arcade, grip: config.tires.grip, peakSlip: peakSlipAngle(config.tires),
    steerPeakSlipScale: config.steerPeakSlipScale, downforcePerKg: config.downforceCoefficient / config.massKg,
    brakeDecel: config.brakeForce / config.massKg }, .8)
})
const intervals: number[] = [], ackDelays: number[] = [], snapshotBytes: number[] = []
const acknowledgedInputs = [0, 0]
const lastArrival = [0, 0], lastAck = [-1, -1], lastTick = [-1, -1], sequence = [0, 0], distance = [0, 0]
const lastPosition: ({ x: number; z: number } | undefined)[] = []
const sentTimes = ids.map(() => new Float64Array(240)), sentSequences = ids.map(() => new Int32Array(240).fill(-1))
let inputsSent = 0, duplicateOrOlderFrames = 0, timer: ReturnType<typeof setInterval> | undefined
function fail(message: string) { failed ??= new Error(message) }
async function waitFor(check: () => boolean, timeoutMs: number) {
  const until = performance.now() + timeoutMs
  while (!check()) {
    if (failed) throw failed
    if (performance.now() >= until) throw new Error('Benchmark setup timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (fraction: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : null
  return { count: sorted.length, p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1) ?? null }
}
try {
  await backend.listen(0, '127.0.0.1')
  const address = backend.gameServer.transport.server!.address()
  const endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${endpoint}/rooms`, { method: 'POST', headers: { Origin: 'http://localhost:5173',
      Authorization: `Bearer ${tokens[i]}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocol: 1,
      action: i ? 'join' : 'create', code: lobbies[0]?.code, carId: 'porsche911' }) })
    if (!response.ok) throw new Error('Synthetic benchmark admission failed')
    const client = await new Client(endpoint).consumeSeatReservation(await response.json())
    clients.push(client); client.reconnection.enabled = false
    client.onMessage('lobby', (value: LobbySnapshot) => {
      lobbies[i] = value
      if (measuring && value.phase !== 'racing') fail('Race left its driving phase; measurement is invalid')
    })
    client.onMessage('notice', () => {})
    client.onLeave(() => { if (measuring) fail('Benchmark socket disconnected') })
    client.onMessage('race', (frame: RaceSnapshot) => {
      if (!measuring) { frames[i] = frame; return }
      if (frame.phase !== 'racing') { fail('Authoritative frame left its driving phase'); return }
      if (frame.tick <= lastTick[i]) { duplicateOrOlderFrames++; return }
      frames[i] = frame
      lastTick[i] = frame.tick
      const now = performance.now()
      if (lastArrival[i]) intervals.push(now - lastArrival[i])
      lastArrival[i] = now
      snapshotBytes.push(Buffer.byteLength(JSON.stringify(frame)))
      const self = frame.vehicles.find(v => v.id === ids[i])
      if (!self || ![self.position.x, self.position.y, self.position.z, self.speed].every(Number.isFinite)) { fail('Invalid authoritative benchmark state'); return }
      const last = lastPosition[i]
      if (last) distance[i] += Math.hypot(self.position.x - last.x, self.position.z - last.z)
      lastPosition[i] = { x: self.position.x, z: self.position.z }
      const ack = self.acknowledgedSequence
      if (ack > lastAck[i] && sentSequences[i][ack % 240] === ack) {
        ackDelays.push(now - sentTimes[i][ack % 240]); lastAck[i] = ack; acknowledgedInputs[i]++
      }
      if (snapshotBytes.length > seconds * 120 + 100) fail('Unexpected frame volume; sample bound exceeded')
    })
    client.send('sync'); await waitFor(() => !!lobbies[i], 5000)
  }
  clients[0].send('laps', 10)
  for (const client of clients) client.send('ready', true)
  await waitFor(() => lobbies[0]?.racers.length === 2 && lobbies[0].racers.every(r => r.ready), 5000)
  clients[0].send('start')
  await waitFor(() => lobbies.every(value => !!value?.race), 10_000)
  const race = lobbies[0]!.race!
  for (const client of clients) client.send('loaded', { protocol: RACE_PROTOCOL, raceId: race.id, fingerprint: race.fingerprint, simulationVersion: race.simulationVersion })
  await waitFor(() => lobbies.every(value => value?.phase === 'racing') && frames.every(value => value?.phase === 'racing'), 10_000)
  const started = performance.now(), cpuStarted = process.cpuUsage(), firstTick = frames[0]!.tick
  const initialMemory = process.memoryUsage()
  peakRssMiB = initialMemory.rss / 1024 / 1024; peakHeapMiB = initialMemory.heapUsed / 1024 / 1024
  measuring = true
  // 34 ms avoids timer truncation producing >30 messages/s. Inputs remain protocol-limited.
  timer = setInterval(() => {
    for (let i = 0; i < 2; i++) {
      const frame = frames[i], state = frame?.vehicles.find(v => v.id === ids[i])
      if (!state || frame?.phase !== 'racing') { fail('Missing current authoritative frame'); continue }
      const q = state.rotation
      const input = drivers[i].update(.034, { x: state.position.x, z: state.position.z, speed: state.speed,
        heading: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) }, [], i, 0, 0)
      if (drivers[i].needsRecovery || Math.abs(state.position.y - bundle.track.line[drivers[i].progress.index].y) > 15) { fail('AI required recovery; measurement is invalid'); continue }
      const index = sequence[i] % 240
      sentTimes[i][index] = performance.now(); sentSequences[i][index] = sequence[i]
      clients[i].send('input', { raceId: race.id, sequence: sequence[i]++, throttle: input.throttle, brake: input.brake,
        steer: input.steer, handbrake: input.handbrake, nitro: input.nitro })
      inputsSent++
    }
  }, 34)
  await waitFor(() => performance.now() - started >= seconds * 1000, seconds * 1000 + 5000)
  if (failed) throw failed
  measuring = false; clearInterval(timer); timer = undefined
  const elapsedMs = performance.now() - started, cpu = process.cpuUsage(cpuStarted), metrics = backend.getMetrics()!
  if (distance.some(value => value < 5) || acknowledgedInputs.some(value => value === 0) || lastArrival.some(value => performance.now() - value > 1000)) throw new Error('No sustained driving/acknowledgement; measurement is invalid')
  const serverTicksObserved = frames[0]!.tick - firstTick
  if (Math.abs(serverTicksObserved - elapsedMs * .06) > 6) throw new Error('Authoritative tick rate missed the 60 Hz budget; measurement is invalid')
  if (metrics.events.input_rejected || metrics.events.race_aborted) throw new Error('Inputs were rejected or the race aborted; measurement is invalid')
  const harnessSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')
  let revision = 'unknown', worktreeDirty = true
  try { revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); worktreeDirty = !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim() } catch { /* non-git checkout remains explicitly unknown */ }
  const report = { schema: 1, revision, worktreeDirty, harnessSha256, protocol: RACE_PROTOCOL, simulationVersion: factory.simulationVersion,
    fingerprint: factory.fingerprint, environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    rooms: 1, racers: 2, wallSeconds: elapsedMs / 1000, serverTicksObserved,
    cpuMs: (cpu.user + cpu.system) / 1000, cpuCoreShare: (cpu.user + cpu.system) / 1000 / elapsedMs,
    peakSampledRssMiB: peakRssMiB, peakSampledHeapMiB: peakHeapMiB, inputsSent, acknowledgedInputs, duplicateOrOlderFrames,
    distanceMetres: distance.map(value => Math.round(value)), frameArrivalMs: percentiles(intervals),
    inputToAckFrameMs: percentiles(ackDelays), snapshotJsonBytes: percentiles(snapshotBytes), metrics,
    scope: 'Local paced single-process server + two SDK clients + AI; loopback, synthetic auth, no DB/renderer/network impairment. Ack latency is not RTT or input-to-display latency. JSON bytes exclude wire framing. Not Fly capacity or two-device acceptance.',
  }
  const directory = new URL('../../.cache/multiplayer/', import.meta.url)
  await mkdir(directory, { recursive: true })
  await writeFile(new URL(`transport-benchmark-${seconds}s.json`, directory), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
} finally {
  measuring = false; clearInterval(timer)
  // Intentional measurement teardown aborts the still-running practice race.
  await backend.shutdown(0)
}
