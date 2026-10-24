import type RAPIER from '@dimforge/rapier3d-compat'
import type { InputState } from '../input/InputManager'
import type { CorrectionState } from '../multiplayer/CorrectionState'
import type { RaceVehicleState } from '../../server/src/protocol'
import type { Surface } from '../vehicles/Surface'
import type { VehicleConfig } from '../vehicles/VehicleConfig'
import { VehiclePhysics } from '../vehicles/VehiclePhysics'
/** Owns one ghost car in an isolated copy of static track collision. No race rules or event publication. */
export class PredictionWorld {
  private readonly world: RAPIER.World
  private readonly vehicle: VehiclePhysics
  constructor(world: RAPIER.World, config: VehicleConfig, surfaceAt: (x: number, z: number) => Surface) {
    this.world = world
    this.vehicle = new VehiclePhysics(config, world, { position: { x: 0, y: 0, z: 0 }, heading: 0 }, true)
    this.vehicle.controller.surfaceAt = surfaceAt
  }
  restore(state: CorrectionState): void {
    const body = this.vehicle.body
    body.setTranslation(state.body.position, false); body.setRotation(state.body.rotation, false)
    body.setLinvel(state.body.velocity, false); body.setAngvel(state.body.angularVelocity, false)
    body.resetForces(false); body.resetTorques(false)
    this.vehicle.controller.restoreState(state.controller)
    if (state.body.sleeping) body.sleep(); else body.wakeUp()
    this.world.propagateModifiedBodyPositionsToColliders()
  }
  step(input: InputState): void { this.vehicle.fixedUpdate(input, 1 / 60); this.world.timestep = 1 / 60; this.world.step() }
  read(out: RaceVehicleState): void {
    const body = this.vehicle.body, controller = this.vehicle.controller
    const p = body.translation(), q = body.rotation(), v = body.linvel(), a = body.angvel()
    out.position.x = p.x; out.position.y = p.y; out.position.z = p.z
    out.rotation.x = q.x; out.rotation.y = q.y; out.rotation.z = q.z; out.rotation.w = q.w
    out.velocity.x = v.x; out.velocity.y = v.y; out.velocity.z = v.z
    out.angularVelocity.x = a.x; out.angularVelocity.y = a.y; out.angularVelocity.z = a.z
    out.speed = controller.forwardSpeed; out.rpm = controller.drivetrain.rpm; out.gear = controller.drivetrain.gear
    out.steer = controller.wheelAngle; out.nitro = controller.nitro.charge; out.nitroIntensity = controller.nitro.intensity; out.braking = controller.braking
    out.wheelOffsets ??= [0, 0, 0, 0]
    for (let i = 0; i < 4; i++) out.wheelOffsets[i] = controller.wheels[i].suspension.wheelOffset()
  }
  dispose(): void { this.world.free() }
}
