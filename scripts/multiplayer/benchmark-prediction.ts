// Own-car prediction quality: the real RaceSession and PredictionReconciler over a simulated ordered (TCP)
// link with jitter and Wi-Fi style stalls, AI driving the real track. Reports rejected inputs and the
// correction each server update applies, split by straights and corners. No sockets or renderer.
// Usage: benchmark-prediction.ts [rttMs=120] [stallChance=.02] [seconds=90] [seed=1]
import { readFile } from 'node:fs/promises'
import RAPIER from '@dimforge/rapier3d-compat'
import { RaceSession, SERVER_TICK_MS } from '../../server/src/RaceSession'
import { CORRECTION_INTERVAL_TICKS } from '../../server/src/protocol'
import { createRaceFactory } from '../../scripts/multiplayer/race-factory'
import { PredictionWorld } from '../../src/simulation/PredictionWorld'
import { PredictionReconciler } from '../../src/multiplayer/PredictionReconciler'
import { decodeCorrectionJson, type CorrectionBinding } from '../../src/multiplayer/CorrectionState'
import { resolveVehicleConfig } from '../../src/vehicles/VehicleConfig'
import { AiDriver } from '../../src/racing/AiDriver'
import { peakSlipAngle } from '../../src/vehicles/TirePhysics'
import { SurfaceMap } from '../../src/world/SurfaceMap'
import { Surface } from '../../src/vehicles/Surface'
import { emptyVehicleState } from '../../src/multiplayer/SnapshotBuffer'

const RTT = Number(process.argv[2] ?? 120), SPIKE = Number(process.argv[3] ?? .02), SECONDS = Number(process.argv[4] ?? 90), SEED = Number(process.argv[5] ?? 1)
let seed = SEED; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
const bundle = JSON.parse(await readFile(new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url), 'utf8'))
const config = resolveVehicleConfig(bundle.cars.porsche911), factory = createRaceFactory(bundle, { scheduledInputs: true })
const racers = ['one', 'two'].map((id, index) => ({ id, sessionId: `seat-${index}`, carId: 'porsche911' as const }))
const race = new RaceSession(racers, factory, 2)
await race.load(factory)
for (const r of racers) race.acknowledge(r.sessionId, { protocol: 3, raceId: race.descriptor.id, fingerprint: bundle.fingerprint, simulationVersion: factory.simulationVersion })
const cw = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
for (const m of bundle.track.meshes) cw.createCollider(RAPIER.ColliderDesc.trimesh(Float32Array.from(m.vertices), Uint32Array.from(m.indices)).setFriction(m.barrier ? .25 : .9).setRestitution(m.barrier ? .2 : 0))
cw.timestep = 1 / 60; cw.step()
const surf = bundle.track.surface ? new SurfaceMap(bundle.track.surface.info, Uint8Array.from(bundle.track.surface.cells)) : null
const world = new PredictionWorld(cw, config, (x, z) => surf?.at(x, z) ?? Surface.Asphalt)
const zs = config.wheels.map((w: any) => w.position[2])
const ai = new AiDriver(bundle.track.line, { wheelbase: Math.max(...zs) - Math.min(...zs), maxSteerAngle: config.maxSteerAngle,
  steerFalloffSpeed: config.steerFalloffSpeed, arcade: config.arcade, grip: config.tires.grip, peakSlip: peakSlipAngle(config.tires),
  steerPeakSlipScale: config.steerPeakSlipScale, downforcePerKg: config.downforceCoefficient / config.massKg, brakeDecel: config.brakeForce / config.massKg }, .8)

// Link: one-way base delay with small jitter and occasional Wi-Fi style stalls; TCP keeps order.
const oneWay = () => RTT / 2 + rand() * 6 + (rand() < SPIKE ? 60 + rand() * 190 : 0)
type Msg = { at: number; fn: () => void }
const up: Msg[] = [], down: Msg[] = []
let upLast = 0, downLast = 0
const sendUp = (t: number, fn: () => void) => { upLast = Math.max(upLast, t + oneWay()); up.push({ at: upLast, fn }) }
const sendDown = (t: number, fn: () => void) => { downLast = Math.max(downLast, t + oneWay()); down.push({ at: downLast, fn }) }
let now = 0, sent = 0, accepted = 0
const LEAD = Math.min(24, Math.max(6, Math.ceil((RTT + 20) * .06) + 4) + 3)
const reconciler = new PredictionReconciler(world, (tick, input) => {
  sent++; const t = now, copy = { ...input }, seq = sent - 1
  sendUp(t, () => { if (race.scheduledInput('seat-0', { version: 1, tick, raceId: race.descriptor.id, sequence: seq, ...copy }, now)) accepted++ })
  return true
}, LEAD)
const binding: CorrectionBinding = { raceId: race.descriptor.id, racerId: 'one', carId: 'porsche911', fingerprint: bundle.fingerprint,
  simulationVersion: factory.simulationVersion, afterTick: -1, acknowledgedSequence: -1, maximumSentSequence: -1, config }
const st = emptyVehicleState('c'), before = emptyVehicleState('b')
const errors: { e: number; steer: number; t: number }[] = []
let lastSteer = 0, lastCorrTick = 0, serverNext = 0, clientNext = 0, clientAcc = 0, lastFrame = 0, suspends = 0
const endMs = (3 + SECONDS) * 1000
for (now = 0; now < endMs; now += .5) {
  while (up.length && up[0].at <= now) up.shift()!.fn()
  while (down.length && down[0].at <= now) down.shift()!.fn()
  if (now >= serverNext) { // Colyseus simulation interval, ~16.7 ms with timer jitter
    race.advance(SERVER_TICK_MS)
    if (race.tick - lastCorrTick >= CORRECTION_INTERVAL_TICKS) {
      lastCorrTick = race.tick; const json = race.correction('seat-0')
      if (json) sendDown(now, () => {
        binding.maximumSentSequence = sent - 1
        const state = decodeCorrectionJson(json, binding); if (!state) return
        binding.afterTick = state.tick; binding.acknowledgedSequence = state.acknowledgedSequence
        const wasReady = reconciler.ready
        if (wasReady) world.read(before)
        if (!reconciler.accept(state, now)) return
        if (wasReady) { world.read(st); errors.push({ e: Math.hypot(st.position.x - before.position.x, st.position.z - before.position.z), steer: lastSteer, t: race.tick }) }
      })
    }
    serverNext += SERVER_TICK_MS + (rand() - .5) * 2
  }
  if (now >= clientNext) { // rAF frame, with occasional long frames; GameLoop steps at most 5 per frame
    const frame = rand() < .01 ? 50 + rand() * 80 : 1000 / 60
    clientAcc += Math.min(250, now - lastFrame) / 1000; lastFrame = now
    let steps = 0
    while (clientAcc >= 1 / 60 && steps < 5) {
      clientAcc -= 1 / 60; steps++
      if (!reconciler.ready) continue
      world.read(st); const q = st.rotation
      const input = ai.update(1 / 60, { x: st.position.x, z: st.position.z, speed: st.speed, heading: Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) }, [], 0, 0, 0)
      lastSteer = Math.abs(input.steer)
      const racing = race.phase === 'racing'
      if (!reconciler.advance(racing ? input : { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }, now)) suspends++
    }
    clientNext = now + frame
  }
  if (race.phase !== 'countdown' && race.phase !== 'racing') break
}
const pct = (a: number[], f: number) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * f))] : NaN }
const racing = errors.filter(r => r.t > 200)
const corner = racing.filter(r => r.steer > .2), straight = racing.filter(r => r.steer <= .05)
console.log(`RTT ${RTT} spikes ${SPIKE} lead ${LEAD}: inputs sent ${sent} rejected ${sent - accepted} (${((sent - accepted) / sent * 100).toFixed(2)}%) suspends ${suspends} phase ${race.phase}`)
for (const [name, rows] of [['straight', straight], ['corner', corner]] as const)
  console.log(`  ${name}: n=${rows.length} p50=${pct(rows.map(r => r.e), .5).toFixed(3)} p95=${pct(rows.map(r => r.e), .95).toFixed(3)} p99=${pct(rows.map(r => r.e), .99).toFixed(3)} max=${Math.max(...rows.map(r => r.e)).toFixed(2)}m  >0.5m: ${rows.filter(r => r.e > .5).length}  >5m snaps: ${rows.filter(r => r.e > 5).length}`)
race.close('done')
