import RAPIER from '@dimforge/rapier3d-compat'
import { PhysicsWorld, initRapier } from '../engine/PhysicsWorld'
import type { InputState } from '../input/InputManager'
import { Surface } from '../vehicles/Surface'
import type { VehicleConfig } from '../vehicles/VehicleConfig'
import { VehiclePhysics, type PhysicsSpawn } from '../vehicles/VehiclePhysics'
import { SurfaceMap, type SurfaceGridInfo } from '../world/SurfaceMap'

export const SIMULATION_VERSION = 1
export const SIMULATION_DT = 1 / 60

/** Offline build output, loaded by trusted server code, never supplied by a racer. */
export interface SimulationTrack {
  id: string
  spawn: PhysicsSpawn
  line: { x: number; y: number; z: number }[]
  checkpoints: { index: number; position: [number, number, number]; tangent: [number, number, number]; radius: number }[]
  meshes: { vertices: number[] | Float32Array; indices: number[] | Uint32Array; barrier: boolean }[]
  surface: { info: SurfaceGridInfo; cells: number[] | Uint8Array } | null
}

const NEUTRAL: InputState = Object.freeze({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false })

/** Fixed-step simulation spike. Scheduling, network messages and race rules live above this boundary. */
export class HeadlessSimulation {
  readonly physics = new PhysicsWorld()
  readonly vehicles = new Map<string, VehiclePhysics>()
  tick = 0
  private readonly inputs = new Map<string, InputState>()
  private readonly surface: SurfaceMap | null

  static async create(track: SimulationTrack): Promise<HeadlessSimulation> {
    await initRapier()
    return new HeadlessSimulation(track)
  }

  private constructor(track: SimulationTrack) {
    this.surface = track.surface ? new SurfaceMap(track.surface.info, track.surface.cells instanceof Uint8Array
      ? track.surface.cells : Uint8Array.from(track.surface.cells)) : null
    const ground = this.physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    for (const mesh of track.meshes) {
      this.physics.world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices instanceof Float32Array ? mesh.vertices : Float32Array.from(mesh.vertices),
        mesh.indices instanceof Uint32Array ? mesh.indices : Uint32Array.from(mesh.indices))
        .setFriction(mesh.barrier ? 0.25 : 0.9).setRestitution(mesh.barrier ? 0.2 : 0), ground)
    }
    // Populate Rapier's query pipeline before the first suspension/ground query.
    this.physics.step(SIMULATION_DT)
  }

  addRacer(id: string, config: VehicleConfig, spawn: PhysicsSpawn): VehiclePhysics {
    if (!id || this.vehicles.has(id) || this.vehicles.size >= 4) throw new Error('Invalid, duplicate or full simulation seat')
    const vehicle = new VehiclePhysics(config, this.physics.world, spawn, true)
    vehicle.controller.surfaceAt = (x, z) => this.surface?.at(x, z) ?? Surface.Asphalt
    this.vehicles.set(id, vehicle)
    this.inputs.set(id, { ...NEUTRAL })
    return vehicle
  }

  /** Copies trusted driving commands. Network sequence/rate/session validation is a later layer. */
  setInput(id: string, input: InputState): void {
    const current = this.inputs.get(id)
    if (!current) throw new Error('Unknown simulation racer')
    if (!Number.isFinite(input.throttle) || input.throttle < 0 || input.throttle > 1
      || !Number.isFinite(input.brake) || input.brake < 0 || input.brake > 1
      || !Number.isFinite(input.steer) || Math.abs(input.steer) > 1
      || typeof input.handbrake !== 'boolean' || typeof input.nitro !== 'boolean'
      || (input.steerSource !== undefined && input.steerSource !== 'keyboard' && input.steerSource !== 'analog')) {
      throw new Error('Invalid simulation input')
    }
    current.throttle = input.throttle
    current.brake = input.brake
    current.steer = input.steer
    current.steerSource = input.steerSource
    current.handbrake = input.handbrake
    current.nitro = input.nitro
  }

  /** Trusted recovery placement: stopped and upright, as offline R. */
  respawn(id: string, spawn: PhysicsSpawn): void {
    const vehicle = this.vehicles.get(id)
    if (!vehicle || !Number.isFinite(spawn.position.x + spawn.position.y + spawn.position.z + spawn.heading)) throw new Error('Invalid simulation respawn')
    vehicle.respawn(spawn)
  }

  step(): void {
    for (const [id, vehicle] of this.vehicles) vehicle.fixedUpdate(this.inputs.get(id)!, SIMULATION_DT)
    this.physics.step(SIMULATION_DT)
    this.tick++
  }

  removeRacer(id: string): void {
    const vehicle = this.vehicles.get(id)
    if (!vehicle) return
    this.physics.world.removeRigidBody(vehicle.body)
    this.vehicles.delete(id)
    this.inputs.delete(id)
  }

  dispose(): void {
    this.vehicles.clear()
    this.inputs.clear()
    this.physics.dispose()
  }
}
