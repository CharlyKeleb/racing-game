import { readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { RaceSession, SERVER_TICK_MS, type RaceFactory, type RaceSeat } from '../../server/src/RaceSession'
import { AiDriver } from '../../src/racing/AiDriver'
import { SIMULATION_DT } from '../../src/simulation/HeadlessSimulation'
import { peakSlipAngle } from '../../src/vehicles/TirePhysics'
import { resolveVehicleConfig } from '../../src/vehicles/VehicleConfig'
import { createRaceFactory, type SimulationBundle } from './race-factory'

// No transport, authentication or result writer: synthetic seats never reach Supabase.
const bundle = JSON.parse(await readFile(new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url), 'utf8')) as SimulationBundle
const laps = Number(process.argv[2] ?? 3)
if (process.argv.length > 3 || ![1, 3].includes(laps)) throw new Error('Usage: check-finished-lap.ts [1|3 laps]')
const seats: RaceSeat[] = [0, 1].map(i => ({ id: `ai-${i}`, sessionId: `local-${i}`, carId: 'porsche911' }))
const config = resolveVehicleConfig(bundle.cars.porsche911)
const wheelZ = config.wheels.map(w => w.position[2])
const drivers = seats.map(() => new AiDriver(bundle.track.line, {
  wheelbase: Math.max(...wheelZ) - Math.min(...wheelZ), maxSteerAngle: config.maxSteerAngle,
  steerFalloffSpeed: config.steerFalloffSpeed, arcade: config.arcade, grip: config.tires.grip,
  peakSlip: peakSlipAngle(config.tires), steerPeakSlipScale: config.steerPeakSlipScale,
  downforcePerKg: config.downforceCoefficient / config.massKg, brakeDecel: config.brakeForce / config.massKg,
}, .8))
const factory: RaceFactory = createRaceFactory(bundle)
const race = new RaceSession(seats, factory, laps)
const distance = [0, 0]
const acceptedInputs = [0, 0]
const crossings = [0, 0]
const poses = seats.map(() => ({ x: 0, z: 0, heading: 0, speed: 0 }))
let failure: string | null = null
const started = performance.now()
try {
  await race.load(factory)
  for (const seat of seats) {
    if (!race.acknowledge(seat.sessionId, {
      protocol: race.descriptor.protocol, raceId: race.descriptor.id,
      fingerprint: race.descriptor.fingerprint, simulationVersion: race.descriptor.simulationVersion,
    })) throw new Error('Asset acknowledgement failed')
  }
  let snapshot = race.snapshot()
  let progress = snapshot?.progress
  if (!snapshot || !progress || progress.length !== seats.length) throw new Error('Missing initial race progress')
  while (race.phase === 'countdown' || race.phase === 'racing') {
    for (let i = 0; i < seats.length; i++) {
      const state = snapshot.vehicles[i]
      if (state?.id !== seats[i].id || progress[i]?.id !== seats[i].id) throw new Error('Unexpected snapshot seat ordering')
      const pose = poses[i]
      if (race.tick > 0) distance[i] += Math.hypot(state.position.x - pose.x, state.position.z - pose.z)
      pose.x = state.position.x; pose.z = state.position.z; pose.speed = state.speed
      const q = state.rotation
      pose.heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))
      if (race.phase !== 'racing' || progress[i].finishTicks !== null) continue
      const input = drivers[i].update(SIMULATION_DT, pose, [], i, 0, 0)
      const centre = bundle.track.line[drivers[i].progress.index]
      if (!Object.values(state.position).every(Number.isFinite) || Math.abs(state.position.y - centre.y) > 15 || drivers[i].needsRecovery) {
        throw new Error(`Seat ${i} needs recovery at tick ${race.tick}`)
      }
      // Normal mailbox admission at 30 Hz, using simulated monotonic milliseconds.
      if (race.tick % 2 === 0) {
        if (!race.input(seats[i].sessionId, {
          ...input, steerSource: 'analog', raceId: race.descriptor.id, sequence: acceptedInputs[i],
        }, Math.round(race.tick * SERVER_TICK_MS))) throw new Error(`Seat ${i} input rejected at tick ${race.tick}`)
        acceptedInputs[i]++
      }
    }
    race.advance(SERVER_TICK_MS)
    const next = race.snapshot()
    if (!next?.progress) throw new Error(race.reason ?? 'Missing authoritative snapshot')
    for (let i = 0; i < seats.length; i++) {
      if (next.progress[i].nextCheckpoint !== progress[i].nextCheckpoint) crossings[i]++
    }
    snapshot = next
    progress = next.progress
  }
  const result = snapshot.result
  if (result?.reason !== 'all-finished' || result.racers.some(r => r.status !== 'finished'
    || r.lapTicks.length !== laps || r.lapTicks.some(tick => !Number.isSafeInteger(tick) || tick <= 0)
    || r.finishTicks !== r.lapTicks.reduce((sum, tick) => sum + tick, 0)
    || r.rank !== 1 + result.racers.filter(other => other.finishTicks! < r.finishTicks!).length)
    || crossings.some(n => n !== bundle.track.checkpoints.length * laps)) throw new Error('Both full ordered-gate races did not finish')
} catch (error) { failure = error instanceof Error ? error.message : 'Unknown failure' }
const final = race.snapshot()
const report = {
  recordedAt: new Date().toISOString(), passed: failure === null, failure,
  fingerprint: bundle.fingerprint, simulationVersion: factory.simulationVersion,
  raceProtocol: race.descriptor.protocol, laps: race.laps, checkpointsPerLap: bundle.track.checkpoints.length,
  tick: race.tick, phase: race.phase, elapsedWallMs: performance.now() - started,
  racers: seats.map((seat, i) => ({ id: seat.id, acceptedInputs: acceptedInputs[i],
    orderedGateCrossings: crossings[i], distanceMetres: Math.round(distance[i]), ...final?.progress?.[i] })),
  result: final?.result, scope: 'Local unpaced real physics, default mailbox, countdown and authoritative ordered-gate lap completion. Synthetic seats; no sockets, browser, Auth, resets, teleports, database writes or hosted/device capacity claim.',
}
await writeFile(new URL('../../.cache/multiplayer/finished-lap.json', import.meta.url), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
race.close('Local acceptance check complete')
if (failure) process.exitCode = 1
