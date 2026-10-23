import RAPIER from '@dimforge/rapier3d-compat'
import type { InputState } from '../input/InputManager'
import { VehicleController } from './VehicleController'
import type { VehicleConfig } from './VehicleConfig'

export interface PhysicsSpawn {
  position: { x: number; y: number; z: number }
  heading: number
}

/** Shared chassis and driving model. No model, renderer, DOM, audio or asset loading. */
export class VehiclePhysics {
  readonly body: RAPIER.RigidBody
  readonly chassis: RAPIER.Collider
  readonly controller: VehicleController

  constructor(config: VehicleConfig, world: RAPIER.World, spawn: PhysicsSpawn, ghost = false) {
    const [hx, hy, hz] = config.chassisHalfExtents
    const m = config.massKg
    const [comX, comY, comZ] = config.centerOfMass
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(m, { x: comX, y: comY, z: comZ }, {
        x: (m / 3) * (hy * hy + hz * hz),
        y: (m / 3) * (hx * hx + hz * hz),
        z: (m / 3) * (hx * hx + hy * hy),
      }, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0).setAngularDamping(0.6).setCcdEnabled(true))
    const [cx, cy, cz] = config.chassisCenter
    const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
      .setTranslation(cx, cy, cz).setDensity(0).setFriction(0.2).setRestitution(0.1)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(m * 9.81 * 1.5)
    // Group 2 cars collide with default group 1 track geometry, never each other.
    if (ghost) desc.setCollisionGroups(0x00020001)
    this.chassis = world.createCollider(desc, this.body)
    this.controller = new VehicleController(config, this.body, world, ghost)
    this.respawn(spawn)
  }

  fixedUpdate(input: InputState, dt: number): void {
    this.controller.update(input, dt)
  }

  respawn(spawn: PhysicsSpawn): void {
    const half = spawn.heading / 2
    this.body.setTranslation(spawn.position, true)
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.body.resetForces(true)
    this.body.resetTorques(true)
    this.controller.reset()
  }
}
