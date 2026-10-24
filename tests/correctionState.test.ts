import RAPIER from '@dimforge/rapier3d-compat'
import { readFile } from 'node:fs/promises'
import { beforeAll, expect, it } from 'vitest'
import { initRapier } from '../src/engine/PhysicsWorld'
import { decodeCorrectionJson, MAX_CORRECTION_BYTES, type CorrectionBinding, type CorrectionState } from '../src/multiplayer/CorrectionState'
import { DEFAULT_VEHICLE_CONFIG, resolveVehicleConfig, type VehicleConfig } from '../src/vehicles/VehicleConfig'
import { VehiclePhysics } from '../src/vehicles/VehiclePhysics'
import { LOBBY_CARS, RACE_PROTOCOL, type LobbyCar } from '../server/src/protocol'
beforeAll(() => initRapier())
function fixture(config: VehicleConfig = DEFAULT_VEHICLE_CONFIG, carId: LobbyCar = 'porsche911') {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = 1 / 60
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, .1, 500).setTranslation(0, -.1, 0))
  const car = new VehiclePhysics(config, world, { position: { x: 0, y: .3, z: 0 }, heading: 0 }, true)
  const binding: CorrectionBinding = { raceId: 'race-one', racerId: 'owner-one', carId,
    fingerprint: 'a'.repeat(64), simulationVersion: 1, afterTick: -1, acknowledgedSequence: -1, maximumSentSequence: 10, config }
  const capture = (tick = 180): CorrectionState => {
    const p = car.body.translation(), q = car.body.rotation(), v = car.body.linvel(), a = car.body.angvel()
    return { version: 1, raceProtocol: RACE_PROTOCOL, raceId: binding.raceId, racerId: binding.racerId, carId,
      fingerprint: binding.fingerprint, simulationVersion: 1, tick, acknowledgedSequence: -1,
      inputApplication: { mode: 'hold', firstTick: null, lastTick: null },
      body: { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
        velocity: { x: v.x, y: v.y, z: v.z }, angularVelocity: { x: a.x, y: a.y, z: a.z }, sleeping: car.body.isSleeping() },
      controller: car.controller.captureState() }
  }
  return { world, car, binding, capture }
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const parse = (value: unknown, binding: CorrectionBinding) => decodeCorrectionJson(JSON.stringify(value), binding)
it('decodes exactly, returns detached state and cannot mutate controllers or acceptance cursors', () => {
  const f = fixture()
  try {
    const source = f.capture(), bindingBefore = { ...f.binding }, before = f.car.controller.captureState()
    const decoded = parse(source, f.binding)
    expect(decoded).toEqual(source)
    expect(f.binding).toEqual(bindingBefore); expect(f.car.controller.captureState()).toEqual(before)
    source.controller.nitro.charge = 1
    expect(decoded?.controller.nitro.charge).toBe(0)
    expect(decoded?.controller.drift.sinceEnd).toBeNull()
    f.car.controller.restoreState(decoded!.controller)
    expect(f.car.controller.drift.sinceEnd).toBe(Infinity)
    expect(f.car.controller.captureState()).toEqual(before)
  } finally { f.world.free() }
})
it('rejects foreign provenance, stale ticks, acknowledgement rollback and unsent sequences', () => {
  const f = fixture()
  try {
    const valid = f.capture(200)
    valid.acknowledgedSequence = 5; valid.inputApplication = { mode: 'command', firstTick: 181, lastTick: 200 }
    const binding = { ...f.binding, afterTick: 199, acknowledgedSequence: 4 }
    expect(parse(valid, binding)).not.toBeNull()
    for (const change of [{ version: 2 }, { raceProtocol: RACE_PROTOCOL + 1 }, { raceId: 'other' }, { racerId: 'other' },
      { carId: 'diablo' }, { fingerprint: 'b'.repeat(64) }, { simulationVersion: 2 }, { tick: 199 }, { tick: 200.5 },
      { tick: 36181 }, { acknowledgedSequence: 3 }, { acknowledgedSequence: 11 },
      { inputApplication: { mode: 'command', firstTick: 181, lastTick: 199 } }]) expect(parse({ ...valid, ...change }, binding)).toBeNull()
    for (const change of [{ afterTick: NaN }, { acknowledgedSequence: -2 }, { maximumSentSequence: 3 }, { simulationVersion: 0 }]) {
      expect(parse(valid, { ...binding, ...change })).toBeNull()
    }
  } finally { f.world.free() }
})
it('rejects every missing or malformed leaf, including hidden control timers and flags', () => {
  const f = fixture()
  try {
    const valid = f.capture(), leaves: string[][] = []
    function visit(value: unknown, path: string[]) {
      if (value !== null && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, [...path, key])
      else leaves.push(path)
    }
    visit(valid, []); expect(leaves.length).toBeGreaterThan(100)
    for (const path of leaves) for (const remove of [true, false]) {
      const modified = clone(valid)
      let parent = modified as unknown as Record<string, unknown>
      for (const part of path.slice(0, -1)) parent = parent[part] as Record<string, unknown>
      if (remove) delete parent[path.at(-1)!]
      else parent[path.at(-1)!] = 'invalid'
      expect(parse(modified, f.binding), path.join('.')).toBeNull()
    }
  } finally { f.world.free() }
})
it('bounds bytes, shape, enums, coordinates, counters and configuration fields without clamping', () => {
  const f = fixture()
  try {
    expect(decodeCorrectionJson(' '.repeat(MAX_CORRECTION_BYTES + 1), f.binding)).toBeNull()
    expect(decodeCorrectionJson('{', f.binding)).toBeNull()
    expect(decodeCorrectionJson(123 as never, f.binding)).toBeNull()
    const ascii = JSON.stringify(f.capture())
    expect(decodeCorrectionJson(' '.repeat(MAX_CORRECTION_BYTES - ascii.length) + ascii, f.binding)).toEqual(f.capture())
    expect(decodeCorrectionJson(ascii.replace('{', '{"__proto__":{"polluted":true},'), f.binding)).toBeNull()
    expect(Object.prototype).not.toHaveProperty('polluted')
    expect(parse(f.capture(), { ...f.binding, config: { ...f.binding.config, engine: { ...f.binding.config.engine, redlineRpm: NaN } } })).toBeNull()
    const changes: ((s: CorrectionState) => void)[] = [
      s => { s.body.position.x = 1_000_001 }, s => { s.body.velocity.x = 1001 }, s => { s.body.rotation.w = .5 },
      s => { s.controller.wheels.push(clone(s.controller.wheels[0])) }, s => { s.controller.wheels.pop() },
      s => { s.controller.wheels[0].surface = 6 as never },
      s => { s.controller.wheels[0].suspension.compression = f.binding.config.suspension.travel + .1 },
      s => { s.controller.drivetrain.gear = f.binding.config.engine.gearRatios.length },
      s => { s.controller.drivetrain.rpm = f.binding.config.engine.redlineRpm + 1 }, s => { s.controller.drivetrain.shiftTimer = -.11 },
      s => { s.controller.nitro.intensity = f.binding.config.nitro.perfectBoost + 1 }, s => { s.controller.nitro.charge = 1.01 },
      s => { s.controller.backfire.seed = 0x1_0000_0000 }, s => { s.controller.backfire.count = .5 },
      s => { s.controller.backfire.burst = 6 }, s => { s.controller.drift.sinceEnd = -1 },
      s => { s.controller.drift.direction = 2 }, s => { s.controller.drift.active = 1 as never },
      s => { (s as unknown as Record<string, unknown>).extra = 1 },
      s => { (s.controller.nitro as unknown as Record<string, unknown>).secret = 'no' },
    ]
    for (const change of changes) { const state = f.capture(); change(state); expect(parse(state, f.binding)).toBeNull() }
    const text = JSON.stringify(f.capture()).replace('"forwardSpeed":0', '"forwardSpeed":1e309')
    expect(decodeCorrectionJson(text, f.binding)).toBeNull()
    const unicode = f.capture(); unicode.racerId = 'é'.repeat(128)
    const compact = JSON.stringify(unicode), padded = ' '.repeat(MAX_CORRECTION_BYTES - compact.length) + compact
    expect(padded.length).toBe(MAX_CORRECTION_BYTES)
    expect(decodeCorrectionJson(padded, { ...f.binding, racerId: unicode.racerId })).toBeNull()
  } finally { f.world.free() }
})
it('accepts live checkpoints from all approved stock cars during steering, boost, braking and drift-mode states', async () => {
  for (const carId of LOBBY_CARS) {
    const config = resolveVehicleConfig(JSON.parse(await readFile(new URL('../public/models/cars/' + carId + '/vehicle-config.json', import.meta.url), 'utf8')))
    const f = fixture(config, carId)
    try {
      f.car.controller.nitro.charge = 1
      for (let tick = 1; tick <= 240; tick++) {
        if (tick === 120) f.car.controller.setDriftMode(true)
        f.car.controller.update({ throttle: tick % 100 < 70 ? 1 : 0, brake: tick % 100 >= 70 ? 1 : 0,
          steer: tick % 120 < 60 ? .7 : -.4, handbrake: tick % 90 > 75, nitro: tick % 150 < 80 }, 1 / 60)
        f.world.step()
        if (tick % 11 === 0) { const captured = f.capture(180 + tick); expect(parse(captured, f.binding), carId + ' at ' + tick).toEqual(captured) }
      }
    } finally { f.world.free() }
  }
})
