import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { startingGrid } from '../src/racing/StartingGrid'
import { RACE_INTRO_SECONDS } from '../src/camera/RaceIntroCamera'
import { AI_DIFFICULTIES, DRIVER_PROFILES } from '../src/racing/AiProfiles'
import { steeringLimit } from '../src/vehicles/SteeringLimit'
import { AiDriver } from '../src/racing/AiDriver'
import { RaceStandings, type RaceEntry } from '../src/racing/RaceStandings'
import { initRapier, PhysicsWorld } from '../src/engine/PhysicsWorld'
import { measureRoadEdges } from '../src/world/SurfaceMap'
import { Track } from '../src/world/Track'
import { TEST_CIRCUIT } from '../src/world/tracks'
import { Vehicle } from '../src/vehicles/Vehicle'
import { buildPlaceholderCar, rigCarModel } from '../src/vehicles/CarModel'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import { Opponent } from '../src/racing/Opponent'

const circle = Array.from({ length: 160 }, (_, i) => ({ x: 80 * Math.cos(i * Math.PI / 80), y: 0, z: 80 * Math.sin(i * Math.PI / 80) }))
const config = { wheelbase: 2.7, maxSteerAngle: 0.55, steerFalloffSpeed: 30 }
describe('AI numeric control', () => {
  it('steers toward the route, limits catch-up and produces finite bounded inputs', () => {
    const driver = new AiDriver(circle, config)
    const pose = { x: 80, z: 0, heading: 0, speed: 20 }
    driver.update(1 / 60, pose, [], 1, 0, 2)
    expect(driver.input.steer).toBeGreaterThan(0)
    const speed = driver.targetSpeed
    driver.update(1 / 60, pose, [], 1, 100000, 2)
    expect(driver.targetSpeed).toBeCloseTo(speed * 1.08)
    driver.update(1 / 60, pose, [], 1, -100000, 2)
    expect(driver.targetSpeed).toBeCloseTo(speed * 0.98 / 1.08 * 1.08)
    for (const v of [driver.input.steer, driver.input.throttle, driver.input.brake]) expect(Number.isFinite(v)).toBe(true)
    expect(Math.abs(driver.input.steer)).toBeLessThanOrEqual(1)
  })
  it('plans corner speed from each preset’s grip share and the car’s own tires', () => {
    for (const difficulty of ['relaxed','challenging','intense'] as const) {
      for (const grip of [1.25,1.7,1.95]) {
        const driver = new AiDriver(circle,{...config,grip},1,DRIVER_PROFILES[0],difficulty)
        expect(driver.speeds[0]).toBeCloseTo(Math.sqrt(AI_DIFFICULTIES[difficulty].cornerGripShare*grip*9.81*80),5)
      }
    }
  })
  it('normalises AI steering against the same grip limit as the vehicle', () => {
    const limitedConfig={...config,grip:1.7,peakSlip:.125,steerFalloffSpeed:10,steerPeakSlipScale:.5}
    const legacyConfig={...limitedConfig,steerPeakSlipScale:0}
    const limited=new AiDriver(circle,limitedConfig),legacy=new AiDriver(circle,legacyConfig)
    const pose={x:80,z:0,heading:0,speed:28}
    limited.update(1/60,pose,[],1,0,2)
    legacy.update(1/60,pose,[],1,0,2)
    expect(Math.abs(limited.input.steer)).toBeGreaterThan(Math.abs(legacy.input.steer))
    expect(limited.input.steer*steeringLimit(limitedConfig,pose.speed)).toBeCloseTo(legacy.input.steer*steeringLimit(legacyConfig,pose.speed))
  })
  it('never plans more braking than the hardware allows, even for an aggressive profile', async () => {
    const {readFile}=await import('node:fs/promises')
    const manifest=JSON.parse(await readFile('public/models/tracks/nurburgring/track.json','utf8')) as {line:[number,number,number][]}
    const line=manifest.line.map(([x,y,z])=>({x,y,z}))
    for(const difficulty of ['relaxed','challenging','intense'] as const){
      const driver=new AiDriver(line,{...config,grip:1.95,brakeDecel:3},1,DRIVER_PROFILES[2],difficulty)
      let peak=0
      for(let i=0;i<line.length;i++){
        const ds=driver.distances[i+1]-driver.distances[i]
        peak=Math.max(peak,(driver.speeds[i]**2-driver.speeds[(i+1)%line.length]**2)/(2*ds))
      }
      expect(peak).toBeCloseTo(3,6)
    }
  })
  it('brakes for a slower car and never boosts through traffic', () => {
    const driver = new AiDriver(circle, config)
    driver.update(1 / 60, { x: 80, z: 0, heading: 0, speed: 20 }, [{ id: 0, x: 80, z: 6, heading: 0, speed: 0 }], 1, 0, 0)
    expect(driver.input.brake).toBeGreaterThan(0)
    expect(driver.input.throttle).toBe(0)
    expect(driver.input.nitro).toBe(false)
  })
  it('requests recovery after sustained immobility and clears it on reset', () => {
    const driver = new AiDriver(circle, config)
    for (let i = 0; i < 720; i++) driver.update(1 / 60, { x: 80, z: 0, heading: 0, speed: 0 }, [], 1, 0, 2)
    expect(driver.needsRecovery).toBe(true)
    driver.reset()
    expect(driver.needsRecovery).toBe(false)
  })
})

it('ranks validated sectors and preserves finish order', () => {
  const standings = new RaceStandings(circle, [0, 40, 80, 120].map(i => ({ position: circle[i] })))
  const base: RaceEntry = { id: 0, name: 'You', player: true, lap: 1, checkpoint: 0, index: 159, finishMs: null }
  const rival = { ...base, id: 1, player: false, index: 20 }
  expect(standings.snapshot([base, rival])[0].id).toBe(1)
  expect(standings.progress({ ...base, index: 90 })).toBe(0)
  expect(standings.snapshot([{ ...base, finishMs: 1100 }, { ...rival, finishMs: 1000 }])[0].id).toBe(1)
})

it('drives a complete checkpoint-validated procedural lap using real vehicle physics', async () => {
  await initRapier()
  const physics = new PhysicsWorld()
  const texture = vi.spyOn(Track.prototype as unknown as { canvasTexture(): THREE.Texture }, 'canvasTexture').mockImplementation(() => new THREE.Texture())
  const track = new Track(TEST_CIRCUIT, physics.world)
  texture.mockRestore()
  const config = DEFAULT_VEHICLE_CONFIG
  const opponent = new Opponent(1, buildPlaceholderCar(config), config, physics.world, track, track.spawn)
  opponent.start(1)
  let resets = 0
  try {
    for (let i = 0; i < 60 * 180 && opponent.race.state !== 'finished'; i++) {
      opponent.readPose()
      if (opponent.driver.needsRecovery) resets++
      opponent.drive(1 / 60, [opponent.pose], 0, 2)
      physics.step(1 / 60)
      opponent.capture(1 / 60)
    }
    expect({ state: opponent.race.state, gate: opponent.race.lastCheckpoint, index: opponent.driver.progress.index, pose: opponent.pose, resets }).toMatchObject({ state: 'finished', resets: 0 })
    const finishTime = opponent.entry.finishMs
    for (let i = 0; i < 60 * 8; i++) {
      opponent.readPose()
      opponent.drive(1 / 60, [opponent.pose], 100, 2)
      physics.step(1 / 60)
      opponent.capture(1 / 60)
    }
    opponent.readPose()
    expect(Math.abs(opponent.pose.speed)).toBeLessThan(1)
    expect(opponent.entry.finishMs).toBe(finishTime)
  } finally { opponent.dispose(); track.dispose(); physics.dispose() }
}, 30000)

it.each(['bmw', 'porsche911', 'koenigsegg', 'mixed', 'mixed relaxed', 'mixed intense', 'mixed legend', 'drift-park', 'drift-park relaxed', 'drift-park intense', 'drift-park legend'])('races a three-car %s field over track collision for two laps', async (scenario) => {
  const [field, preset] = scenario.split(' ')
  const driftPark = field === 'drift-park'
  const car = driftPark ? 'mixed' : field
  const difficulty = (preset ?? 'challenging') as import('../src/racing/AiProfiles').AiDifficulty
  const { readFile } = await import('node:fs/promises')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
  const { StreamedTrack } = await import('../src/world/StreamedTrack')
  const { resolveVehicleConfig } = await import('../src/vehicles/VehicleConfig')
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  await initRapier()
  const physics = new PhysicsWorld()
  const assets = {
    loadJson: async (url: string) => JSON.parse(await readFile(`public${url}`, 'utf8')),
    loadBinary: async (url: string) => new Uint8Array(await readFile(`public${url}`)),
    loadGltf: async (url: string) => {
      const bytes = await readFile(`public${url}`)
      return loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
    },
  }
  const track = await StreamedTrack.load(`/models/tracks/${driftPark ? 'drift-park' : 'nurburgring'}/track.json`, { assets: assets as unknown as import('../src/engine/AssetManager').AssetManager, world: physics.world, renderer: {} as THREE.WebGLRenderer, camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(), quality: 'low' })
  const config = resolveVehicleConfig(JSON.parse(await readFile(`public/models/cars/${car === 'mixed' ? 'bmw' : car}/vehicle-config.json`, 'utf8')))
  const configs = car === 'mixed' ? await Promise.all(['bmw', 'porsche911', 'koenigsegg'].map(async id => resolveVehicleConfig(JSON.parse(await readFile(`public/models/cars/${id}/vehicle-config.json`, 'utf8'))))) : [config, config, config]
  const grid = startingGrid(track.line,track.spawn.position,4)
  const opponents = [1, 2, 3].map(id => {
    const slot = grid[id-1]
    const spawn = { position: new THREE.Vector3(slot.x,slot.y+0.6,slot.z), heading: slot.heading }
    const rival = new Opponent(id, buildPlaceholderCar(configs[id - 1]), configs[id - 1], physics.world, track, spawn, difficulty)
    rival.start(2,RACE_INTRO_SECONDS)
    return rival
  })
  const respawns = opponents.map(o => vi.spyOn(o.vehicle, 'respawn'))
  const edges = measureRoadEdges(track.line, (x, z) => track.surfaceAt(x, z))
  const obstruction = { position: track.spawn.position.clone().add(new THREE.Vector3(Math.sin(track.spawn.heading)*30,0,Math.cos(track.spawn.heading)*30)), heading:track.spawn.heading }
  const blocker = new Vehicle(config, rigCarModel(buildPlaceholderCar(config), config), physics.world, obstruction)
  blocker.controller.surfaceAt = (x, z) => track.surfaceAt(x, z)
  const blockedPose = { id: 0, x: track.spawn.position.x, z: track.spawn.position.z, heading: track.spawn.heading, speed: 0 }
  const traffic = [blockedPose, ...opponents.map(o => o.pose)]
  let recoveries = 0
  const incidents: unknown[] = []
  const boosts = [0,0,0], drifts = [0,0,0]
  try {
    for (let i = 0; i < 60 * 1000 && opponents.some(o => o.race.state !== 'finished'); i++) {
      const b = blocker.body.translation()
      blockedPose.x = b.x; blockedPose.z = b.z
      blocker.fixedUpdate({ throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }, 1 / 60)
      for (const o of opponents) o.readPose()
      for (const o of opponents) {
        const j = o.driver.progress.index
        o.drive(1 / 60, traffic, 0, Math.max(0, Math.min(edges.left[j], edges.right[j]) - 2))
        if (o.driver.input.nitro) boosts[o.id - 1]++
        if (o.vehicle.controller.drift.active) drifts[o.id - 1]++
        if (o.driver.needsRecovery) { recoveries++; incidents.push({ id:o.id, index:o.driver.progress.index, pose:{...o.pose}, drift:o.vehicle.controller.drift.active, phase:o.driver.passing.phase }) }
      }
      physics.step(1 / 60)
      for (const o of opponents) o.capture(1 / 60, traffic)
    }
    expect(opponents.map(o => ({ state: o.race.state, gate: o.race.lastCheckpoint, pose: o.pose })), JSON.stringify(opponents.map(o => ({ id:o.id, lap:o.race.lap, gate:o.race.lastCheckpoint, index:o.driver.progress.index, pose:o.pose, input:o.driver.input, target:o.driver.targetSpeed, lane:(o.driver as unknown as {lane:number}).lane })))).toMatchObject([{ state: 'finished' }, { state: 'finished' }, { state: 'finished' }])
    console.info(`[AI ${scenario}] ${JSON.stringify(opponents.map((o,i) => ({driver:o.driver.profile.name, car:configs[i].id, difficulty, lapsMs:o.race.timer.laps.map(t=>Math.round(t)), recoveries:respawns[i].mock.calls.length})))}`)
    expect(opponents.map(o=>o.race.timer.laps.length)).toEqual([2,2,2])
    expect(respawns.reduce((sum,spy)=>sum+spy.mock.calls.length,0)).toBe(0)
    expect(recoveries, JSON.stringify({incidents, boosts, drifts})).toBe(0)
    if (!driftPark) {
      expect(boosts.reduce((sum,n)=>sum+n,0), JSON.stringify({boosts,drifts})).toBeGreaterThan(0)
      expect(drifts[2], JSON.stringify({boosts,drifts})).toBeGreaterThan(0)
    }
  } finally { for (const o of opponents) o.dispose(); physics.world.removeRigidBody(blocker.body); track.dispose(); physics.dispose() }
}, 30000)


it('updates sub-waypoint overtakes and orders cars behind the start line', () => {
  const line = [{x:0,y:0,z:0}, {x:0,y:0,z:4}, {x:0,y:0,z:8}, {x:10,y:0,z:8}, {x:10,y:0,z:0}]
  const standings = new RaceStandings(line, [{ position: line[0] }, { position: line[3] }])
  const a: RaceEntry = { id:0, name:'You', player:true, lap:1, checkpoint:0, index:1, finishMs:null, x:0, z:4.2 }
  const b = { ...a, id:1, player:false, z:4.3 }
  expect(standings.snapshot([a,b])[0].id).toBe(1)
  // Still between waypoints (4 m apart), but clear of the side-by-side hold.
  a.z = 5.2
  expect(standings.snapshot([a,b])[0].id).toBe(0)
  a.z = -9; b.z = -8
  expect(standings.snapshot([a,b])[0].id).toBe(1)
  expect(standings.progress({ ...a, x:10, z:8 })).toBeLessThan(1)
})

it('Drift Park route never doubles back between adjacent waypoints', async () => {
  const { readFile } = await import('node:fs/promises')
  const { line } = JSON.parse(await readFile('public/models/tracks/drift-park/track.json', 'utf8')) as { line: [number, number, number][] }
  for (let i = 0; i < line.length; i++) {
    const a = line[(i - 1 + line.length) % line.length], b = line[i], c = line[(i + 1) % line.length]
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[2] - a[2]) * (c[2] - b[2])
    expect(dot, `route reverses at waypoint ${i}`).toBeGreaterThan(0)
  }
})
