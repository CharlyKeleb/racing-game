import { readFile, writeFile } from 'node:fs/promises'
import { cpus, platform, arch } from 'node:os'
import { performance } from 'node:perf_hooks'
import { HeadlessSimulation, SIMULATION_DT, SIMULATION_VERSION, type SimulationTrack } from '../../src/simulation/HeadlessSimulation'
import { resolveVehicleConfig, type VehicleConfig } from '../../src/vehicles/VehicleConfig'
import { startingGrid } from '../../src/racing/StartingGrid'
import { AiDriver } from '../../src/racing/AiDriver'
import { peakSlipAngle } from '../../src/vehicles/TirePhysics'

const bundle = JSON.parse(await readFile(new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url), 'utf8')) as {
  format: number; fingerprint: string; track: SimulationTrack; cars: Record<string, Partial<VehicleConfig>>
}
if (bundle.format !== 1) throw new Error('Unsupported asset package')
const count = Number(process.argv[2] ?? 2)
const seconds = Number(process.argv[3] ?? 180)
if (!Number.isInteger(count) || count < 1 || count > 4 || !Number.isInteger(seconds) || seconds < 1 || seconds > 600) throw new Error('Usage: benchmark.ts [1-4 racers] [1-600 simulated seconds]')
const simulation = await HeadlessSimulation.create(bundle.track)
try {
  const config = resolveVehicleConfig(bundle.cars.porsche911)
  const grid = startingGrid(bundle.track.line, bundle.track.spawn.position, count)
  const racers = grid.map((slot, i) => {
    // Match the browser's ground placement; suspension settles during warmup.
    const y = simulation.physics.groundHeight(slot.x, slot.y, slot.z)
    if (y === null) throw new Error('Grid has no collision ground')
    const vehicle = simulation.addRacer(String(i), config, { position: { x: slot.x, y: y + 0.3, z: slot.z }, heading: slot.heading })
    const zs = config.wheels.map(w => w.position[2])
    const driver = new AiDriver(bundle.track.line, { wheelbase: Math.max(...zs) - Math.min(...zs), maxSteerAngle: config.maxSteerAngle,
      steerFalloffSpeed: config.steerFalloffSpeed, arcade: config.arcade, grip: config.tires.grip, peakSlip: peakSlipAngle(config.tires),
      steerPeakSlipScale: config.steerPeakSlipScale, downforcePerKg: config.downforceCoefficient / config.massKg, brakeDecel: config.brakeForce / config.massKg }, 0.8)
    return { vehicle, driver, id: String(i), pose: { x: slot.x, z: slot.z, heading: slot.heading, speed: 0 }, distance: 0 }
  })
  for (let i = 0; i < 120; i++) simulation.step()
  const samples: number[] = []
  const cpuStart = process.cpuUsage()
  const started = performance.now()
  for (let tick = 0; tick < seconds * 60; tick++) {
    const start = performance.now()
    for (const racer of racers) {
      const { vehicle, driver, pose } = racer
      const p = vehicle.body.translation(), q = vehicle.body.rotation()
      racer.distance += Math.hypot(p.x - pose.x, p.z - pose.z)
      pose.x = p.x; pose.z = p.z
      pose.heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))
      pose.speed = vehicle.controller.forwardSpeed
      simulation.setInput(racer.id, driver.update(SIMULATION_DT, pose, [], Number(racer.id), 0, 0))
      const centre = bundle.track.line[driver.progress.index]
      if (![p.x, p.y, p.z].every(Number.isFinite) || Math.abs(p.y - centre.y) > 15 || driver.needsRecovery) {
        throw new Error(`Racer ${racer.id} left the drivable simulation at tick ${tick}; benchmark is invalid`)
      }
    }
    simulation.step()
    samples.push(performance.now() - start)
  }
  const elapsedMs = performance.now() - started
  const cpu = process.cpuUsage(cpuStart)
  samples.sort((a, b) => a - b)
  const percentile = (p: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]
  const report = { simulationVersion: SIMULATION_VERSION, fingerprint: bundle.fingerprint,
    environment: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    racers: count, simulatedSeconds: seconds, measuredTicks: samples.length, elapsedMs,
    cpuMs: (cpu.user + cpu.system) / 1000, tickMs: { p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: samples.at(-1) },
    rssMiB: process.memoryUsage().rss / 1024 / 1024,
    distanceMetres: racers.map(r => Math.round(r.distance)),
    scope: 'Local unpaced AI-driven physics spike; no networking, persistence, renderer, finish validation or Fly capacity claim.',
  }
  const json = JSON.stringify(report, null, 2) + '\n'
  await writeFile(new URL(`../../.cache/multiplayer/benchmark-${count}.json`, import.meta.url), json)
  console.log(json)
} finally { simulation.dispose() }
