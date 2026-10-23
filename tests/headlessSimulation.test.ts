import { beforeAll, describe, expect, it } from 'vitest'
import RAPIER from '@dimforge/rapier3d-compat'
import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { HeadlessSimulation, SIMULATION_DT, type SimulationTrack } from '../src/simulation/HeadlessSimulation'
import { DEFAULT_VEHICLE_CONFIG, resolveVehicleConfig, type VehicleConfig } from '../src/vehicles/VehicleConfig'
import { VehiclePhysics } from '../src/vehicles/VehiclePhysics'
import { LOBBY_CARS } from '../server/src/protocol'
import { decodeSurfaceRle } from '../src/world/SurfaceMap'
// Build-time tooling deliberately stays outside the browser/server runtime module graph.
// @ts-expect-error Node asset exporter is an ES module without TypeScript declarations.
import { buildSimulationAssets } from '../scripts/multiplayer/build-simulation-assets.mjs'

const spawn = { position: { x: 0, y: .3, z: 0 }, heading: 0 }
const track: SimulationTrack = { id: 'fixture', spawn, line: [], checkpoints: [], surface: null,
  meshes: [{ vertices: [-1000, 0, -1000, -1000, 0, 1000, 1000, 0, 1000, 1000, 0, -1000], indices: [0, 1, 2, 0, 2, 3], barrier: false }] }
const drive = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
const cfg = DEFAULT_VEHICLE_CONFIG

beforeAll(() => RAPIER.init())

describe('headless shared vehicle simulation', () => {
  it('runs in Node with no browser globals, and replays two racers identically', async () => {
    expect(typeof window).toBe('undefined')
    const a = await HeadlessSimulation.create(track), b = await HeadlessSimulation.create(track)
    try {
      for (const sim of [a, b]) {
        sim.addRacer('one', cfg, spawn)
        sim.addRacer('two', cfg, { position: { x: 6, y: .3, z: 0 }, heading: 0 })
      }
      for (let tick = 0; tick < 600; tick++) for (const sim of [a, b]) {
        sim.setInput('one', { ...drive, steer: tick > 300 ? .2 : 0 })
        sim.setInput('two', { ...drive, throttle: .6 })
        sim.step()
      }
      expect(a.tick).toBe(600)
      for (const id of ['one', 'two']) {
        expect(a.vehicles.get(id)!.body.translation()).toEqual(b.vehicles.get(id)!.body.translation())
        expect(a.vehicles.get(id)!.body.rotation()).toEqual(b.vehicles.get(id)!.body.rotation())
        expect(a.vehicles.get(id)!.body.translation().z).toBeGreaterThan(10)
      }
    } finally { a.dispose(); b.dispose() }
  })

  it('ghost chassis and suspension rays ignore overlapping racers', async () => {
    const solo = await HeadlessSimulation.create(track), pair = await HeadlessSimulation.create(track)
    try {
      for (const sim of [solo, pair]) sim.addRacer('one', cfg, spawn)
      pair.addRacer('two', cfg, spawn)
      for (let tick = 0; tick < 300; tick++) for (const sim of [solo, pair]) {
        sim.setInput('one', drive)
        if (sim === pair) sim.setInput('two', drive)
        sim.step()
      }
      const position = solo.vehicles.get('one')!.body.translation()
      expect(pair.vehicles.get('one')!.body.translation()).toEqual(position)
      expect(pair.vehicles.get('two')!.body.translation()).toEqual(position)
      expect(position.y).toBeGreaterThan(-.5)
    } finally { solo.dispose(); pair.dispose() }
  })

  it('uses the same chassis mass, inertia and contact settings as the browser car', async () => {
    const sim = await HeadlessSimulation.create(track)
    try {
      const v = sim.addRacer('one', cfg, spawn)
      sim.step() // Rapier recomputes additional mass properties during the first step.
      expect(v.body.mass()).toBeCloseTo(cfg.massKg)
      const com = v.body.localCom()
      expect(com.x).toBeCloseTo(cfg.centerOfMass[0], 5)
      expect(com.y).toBeCloseTo(cfg.centerOfMass[1], 5)
      expect(com.z).toBeCloseTo(cfg.centerOfMass[2], 5)
      expect(v.chassis.friction()).toBeCloseTo(.2)
      expect(v.chassis.restitution()).toBeCloseTo(.1)
      expect(v.body.isCcdEnabled()).toBe(true)
      expect(v.chassis.activeEvents()).toBe(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
    } finally { sim.dispose() }
  })

  it('resets physical and controller state including pending forces', async () => {
    const sim = await HeadlessSimulation.create(track)
    try {
      const v = sim.addRacer('one', cfg, spawn)
      sim.setInput('one', { ...drive, steer: .5, nitro: true })
      for (let i = 0; i < 100; i++) sim.step()
      v.body.addForce({ x: 1000, y: 0, z: 0 }, true)
      v.respawn(spawn)
      expect(v.body.translation()).toEqual({ x: 0, y: Math.fround(.3), z: 0 })
      expect(v.body.linvel()).toEqual({ x: 0, y: 0, z: 0 })
      expect(v.body.angvel()).toEqual({ x: 0, y: 0, z: 0 })
      expect(v.body.userForce()).toEqual({ x: 0, y: 0, z: 0 })
      expect(v.controller.forwardSpeed).toBe(0)
      expect(v.controller.steerAngle).toBe(0)
      expect(v.controller.drivetrain.gear).toBe(1)
    } finally { sim.dispose() }
  })

  it('copies valid inputs, rejects invalid controls and bounds seats', async () => {
    const sim = await HeadlessSimulation.create(track)
    try {
      sim.addRacer('one', cfg, spawn)
      const input = { ...drive }
      sim.setInput('one', input)
      input.throttle = NaN
      sim.step()
      expect(Number.isFinite(sim.vehicles.get('one')!.body.translation().y)).toBe(true)
      for (const value of [NaN, Infinity, -1, 2]) expect(() => sim.setInput('one', { ...drive, throttle: value })).toThrow('Invalid simulation input')
      expect(() => sim.setInput('missing', drive)).toThrow('Unknown')
      expect(() => sim.addRacer('one', cfg, spawn)).toThrow()
      for (let i = 2; i <= 4; i++) sim.addRacer(String(i), cfg, spawn)
      expect(() => sim.addRacer('five', cfg, spawn)).toThrow()
      const removed = sim.vehicles.get('2')!.body.handle
      sim.removeRacer('2')
      expect(sim.physics.world.getRigidBody(removed)).toBeNull()
      expect(() => sim.addRacer('replacement', cfg, spawn)).not.toThrow()
    } finally { sim.dispose() }
  })

  it('preserves local contact collisions when ghost mode is disabled', async () => {
    const sim = await HeadlessSimulation.create(track)
    try {
      const local = new VehiclePhysics(cfg, sim.physics.world, spawn)
      const other = new VehiclePhysics(cfg, sim.physics.world, spawn)
      for (let i = 0; i < 60; i++) sim.physics.step(SIMULATION_DT)
      const a = local.body.translation(), b = other.body.translation()
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeGreaterThan(.1)
    } finally { sim.dispose() }
  })

  it('ghost racers still collide with track barriers', async () => {
    const sim = await HeadlessSimulation.create(track)
    try {
      sim.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(20, 3, .5).setTranslation(0, 2, 12))
      const v = sim.addRacer('one', cfg, spawn)
      sim.setInput('one', drive)
      for (let i = 0; i < 300; i++) sim.step()
      expect(v.body.translation().z).toBeLessThan(12)
      expect(v.body.translation().z).toBeGreaterThan(5)
    } finally { sim.dispose() }
  })

  it('exports shipped track/stock assets reproducibly and grounds two racers on the real grid', async () => {
    const bundle = await buildSimulationAssets()
    expect(bundle.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect((await buildSimulationAssets()).fingerprint).toBe(bundle.fingerprint)
    expect(Object.keys(bundle.cars)).toEqual([...LOBBY_CARS])
    expect(bundle.track.checkpoints.length).toBeGreaterThan(2)
    expect(bundle.track.meshes.some((m: { barrier: boolean }) => m.barrier)).toBe(true)
    // Independently compare every exported triangle with the browser's GLTF path.
    const bytes = await readFile(new URL('../public/models/tracks/nurburgring/collision.glb', import.meta.url))
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    const browserMeshes: { vertices: number[]; indices: number[]; barrier: boolean }[] = []
    const point = new THREE.Vector3()
    gltf.scene.updateMatrixWorld(true)
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const positions = mesh.geometry.getAttribute('position')
      const vertices = new Float32Array(positions.count * 3)
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld)
        vertices.set([point.x, point.y, point.z], i * 3)
      }
      browserMeshes.push({ vertices: Array.from(vertices), indices: Array.from(mesh.geometry.getIndex()!.array), barrier: mesh.name.startsWith('barrier') })
      mesh.geometry.dispose()
    })
    expect(bundle.track.meshes).toEqual(browserMeshes)
    const surfaceBytes = await readFile(new URL('../public/models/tracks/nurburgring/surface.bin', import.meta.url))
    const info = bundle.track.surface.info
    expect(bundle.track.surface.cells).toEqual(Array.from(decodeSurfaceRle(surfaceBytes, info.width * info.height)))
    const sim = await HeadlessSimulation.create(bundle.track)
    try {
      const s = bundle.track.spawn
      const height = sim.physics.groundHeight(s.position.x, s.position.y, s.position.z)
      expect(height).not.toBeNull()
      const config = resolveVehicleConfig(bundle.cars.porsche911 as Partial<VehicleConfig>)
      for (const id of ['one', 'two']) sim.addRacer(id, config, { position: { ...s.position, y: height! + .3 }, heading: s.heading })
      for (let tick = 0; tick < 180; tick++) {
        for (const id of ['one', 'two']) sim.setInput(id, drive)
        sim.step()
      }
      for (const v of sim.vehicles.values()) {
        expect(Math.abs(v.controller.forwardSpeed)).toBeGreaterThan(5)
        expect(Math.abs(v.body.translation().y - height!)).toBeLessThan(5)
      }
    } finally { sim.dispose() }
  }, 30_000)
})
