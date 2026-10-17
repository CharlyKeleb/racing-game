import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { InputState } from '../input/InputManager'
import type { CarModel } from './CarModel'
import { VehicleController } from './VehicleController'
import type { VehicleConfig } from './VehicleConfig'

export interface SpawnPoint {
  position: THREE.Vector3
  /** Yaw in radians; 0 faces +Z. */
  heading: number
}

/**
 * A car in the world: Rapier chassis body + raycast controller + interpolated
 * visual model. Owns nothing global — Game wires it to input and camera.
 */
export class Vehicle {
  readonly config: VehicleConfig
  readonly controller: VehicleController
  readonly model: CarModel
  readonly body: RAPIER.RigidBody

  // Physics state at the previous and current tick, for render interpolation.
  private readonly prevPos = new THREE.Vector3()
  private readonly currPos = new THREE.Vector3()
  private readonly prevQuat = new THREE.Quaternion()
  private readonly currQuat = new THREE.Quaternion()
  // Steer angle and per-wheel suspension offset at the previous/current tick, same idea.
  private prevSteer = 0
  private currSteer = 0
  private readonly prevOffset: number[]
  private readonly currOffset: number[]

  constructor(config: VehicleConfig, model: CarModel, world: RAPIER.World, spawn: SpawnPoint) {
    this.config = config
    this.model = model

    const [hx, hy, hz] = config.chassisHalfExtents
    const m = config.massKg
    // Box inertia from the collision hull; COM comes from config (kept low).
    const inertia = {
      x: (m / 3) * (hy * hy + hz * hz),
      y: (m / 3) * (hx * hx + hz * hz),
      z: (m / 3) * (hx * hx + hy * hy),
    }
    const [comX, comY, comZ] = config.centerOfMass
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(m, { x: comX, y: comY, z: comZ }, inertia, { x: 0, y: 0, z: 0, w: 1 })
      .setLinearDamping(0) // air drag and rolling resistance are modelled in VehicleController
      .setAngularDamping(0.6)
      .setCcdEnabled(true)
    this.body = world.createRigidBody(bodyDesc)

    const [cx, cy, cz] = config.chassisCenter
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setDensity(0).setFriction(0.2).setRestitution(0.1),
      this.body,
    )

    this.controller = new VehicleController(config, this.body, world)
    this.prevOffset = config.wheels.map(() => config.suspension.restLength)
    this.currOffset = [...this.prevOffset]
    this.respawn(spawn)
  }

  get position(): THREE.Vector3 {
    return this.model.root.position
  }

  get quaternion(): THREE.Quaternion {
    return this.model.root.quaternion
  }

  get speedKmh(): number {
    return Math.abs(this.controller.forwardSpeed) * 3.6
  }

  fixedUpdate(input: InputState, dt: number): void {
    this.controller.update(input, dt)
  }

  /** Call after the physics step to record the new tick's transform. */
  capture(): void {
    this.prevPos.copy(this.currPos)
    this.prevQuat.copy(this.currQuat)
    const t = this.body.translation()
    const r = this.body.rotation()
    this.currPos.set(t.x, t.y, t.z)
    this.currQuat.set(r.x, r.y, r.z, r.w)
    this.prevSteer = this.currSteer
    this.currSteer = this.controller.steerAngle
    const wheels = this.controller.wheels
    for (let i = 0; i < wheels.length; i++) {
      this.prevOffset[i] = this.currOffset[i]
      this.currOffset[i] = wheels[i].suspension.wheelOffset()
    }
  }

  /** Interpolate visuals between ticks and pose the wheels. */
  render(alpha: number): void {
    const root = this.model.root
    root.position.lerpVectors(this.prevPos, this.currPos, alpha)
    root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha)

    const steer = this.prevSteer + (this.currSteer - this.prevSteer) * alpha
    const wheels = this.controller.wheels
    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i]
      const rig = this.model.wheels[w.cfg.id]
      const [x, y, z] = w.cfg.position
      const offset = this.prevOffset[i] + (this.currOffset[i] - this.prevOffset[i]) * alpha
      rig.pivot.position.set(x, y - offset, z)
      rig.pivot.rotation.y = w.cfg.steered ? steer : 0
      rig.spinner.rotation.x = w.spin
    }
  }

  respawn(spawn: SpawnPoint): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.heading)
    this.body.setTranslation(spawn.position, true)
    this.body.setRotation(q, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.controller.reset()
    this.currPos.copy(spawn.position)
    this.currQuat.copy(q)
    this.prevPos.copy(spawn.position)
    this.prevQuat.copy(q)
    this.prevSteer = this.currSteer = 0
  }
}
