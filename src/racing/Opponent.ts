import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { InputState } from '../input/InputManager'
import { Vehicle, type SpawnPoint } from '../vehicles/Vehicle'
import { rigCarModel } from '../vehicles/CarModel'
import type { VehicleConfig } from '../vehicles/VehicleConfig'
import type { RaceTrack } from '../world/RaceTrack'
import { DRIVER_PROFILES, type AiDifficulty } from './AiProfiles'
import { draftingStrength } from './Drafting'
import { AiDriver, type DriverResources, type TrafficCar } from './AiDriver'
import { RaceManager } from './RaceManager'
import type { RaceEntry } from './RaceStandings'

const HOLD: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: true, nitro: false }
const COLORS = [0x27b8eb, 0xffd447, 0xe64f67]
const NAMES = ['Raven', 'Torque', 'Viper']

/** Physics/visual adapter. Numeric driving and standings live in separate modules. */
export class Opponent {
  readonly vehicle: Vehicle
  readonly driver: AiDriver
  readonly race: RaceManager
  readonly pose: TrafficCar
  readonly entry: RaceEntry
  private readonly resources: DriverResources = { charge: 0, boosting: false, drifting: false }
  private readonly position = new THREE.Vector3()
  private readonly ownedMaterials: THREE.Material[] = []
  readonly id: number
  private readonly world: RAPIER.World
  private readonly track: RaceTrack
  constructor(id: number, scene: THREE.Group, config: VehicleConfig, world: RAPIER.World, track: RaceTrack, spawn: SpawnPoint, difficulty: AiDifficulty = 'challenging') {
    this.id = id; this.world = world; this.track = track
    scene.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (!mesh.isMesh) return
      const copy = (mat: THREE.Material) => {
        const own = mat.clone()
        if (/paint|body.?color/i.test(mat.name) && 'color' in own) (own as THREE.MeshStandardMaterial).color.setHex(COLORS[(id - 1) % COLORS.length])
        this.ownedMaterials.push(own)
        return own
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material)
    })
    this.vehicle = new Vehicle(config, rigCarModel(scene, config), world, spawn)
    this.vehicle.controller.surfaceAt = (x, z) => track.surfaceAt(x, z)
    const front = config.wheels.find(w => w.id === 'FL')!, rear = config.wheels.find(w => w.id === 'RL')!
    this.driver = new AiDriver(track.line, { wheelbase: Math.abs(front.position[2] - rear.position[2]), maxSteerAngle: config.maxSteerAngle, steerFalloffSpeed: config.steerFalloffSpeed }, 0.94 + id * 0.025, DRIVER_PROFILES[(id - 1) % DRIVER_PROFILES.length], difficulty)
    this.pose = { id, x: 0, z: 0, heading: spawn.heading, speed: 0 }
    this.entry = { id, name: NAMES[(id - 1) % NAMES.length], player: false, lap: 0, checkpoint: 0, index: 0, finishMs: null, x: spawn.position.x, z: spawn.position.z }
    this.race = new RaceManager(track.checkpoints, 3, { onStateChange: () => {}, onLap: () => {} })
  }
  start(laps: number, introSeconds = 0): void { this.race.start(laps, introSeconds) }
  readPose(): void {
    const p = this.vehicle.body.translation(), q = this.vehicle.body.rotation()
    this.pose.x = p.x; this.pose.z = p.z
    this.pose.heading = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x))
    this.pose.speed = this.vehicle.controller.forwardSpeed
  }
  drive(dt: number, traffic: readonly TrafficCar[], gap: number, laneLimit: number): void {
    const active = this.race.state === 'racing'
    const controller = this.vehicle.controller
    this.resources.charge = controller.nitro.charge
    this.resources.boosting = controller.nitro.active
    this.resources.drifting = controller.drift.active
    controller.drafting = active ? draftingStrength(this.pose, traffic, this.id) : 0
    const input = active ? this.driver.update(dt, this.pose, traffic, this.id, gap, laneLimit, this.resources) : HOLD
    this.vehicle.fixedUpdate(input, dt)
  }
  capture(dt: number, traffic: readonly TrafficCar[] = []): void {
    this.vehicle.capture()
    const p = this.vehicle.body.translation()
    this.position.set(p.x, p.y, p.z)
    this.race.update(dt, this.position)
    if (this.race.state === 'racing' && (p.y < this.track.killY || this.driver.needsRecovery)) {
      const spawn = this.track.respawnAt(this.race.lastCheckpoint)
      // Never drop a recovering car onto another racer. It returns to the last
      // validated gate, so recovery cannot skip a sector or gain a lap.
      if (!traffic.some(car => car.id !== this.id && Math.hypot(car.x - spawn.position.x, car.z - spawn.position.z) < 8)) {
        this.vehicle.respawn(spawn)
        this.position.copy(spawn.position)
        this.driver.reset()
      }
    }
    const e = this.entry
    e.lap = this.race.lap; e.checkpoint = this.race.lastCheckpoint
    e.index = this.driver.progress.index
    e.x = this.position.x; e.z = this.position.z
    if (this.race.state === 'finished') e.finishMs = this.race.timer.totalMs
  }
  dispose(): void {
    this.vehicle.model.root.removeFromParent()
    this.world.removeRigidBody(this.vehicle.body)
    // Geometry/textures are shared with AssetManager's cached GLTF; only owned
    // materials are released here, including Vehicle's cloned lamp materials.
    const materials = new Set(this.ownedMaterials)
    this.vehicle.model.root.traverse(o => {
      if ((o as THREE.Mesh).isMesh) {
        const m = (o as THREE.Mesh).material
        for (const mat of Array.isArray(m) ? m : [m]) materials.add(mat)
      }
    })
    for (const mat of materials) mat.dispose()
  }
}
