import * as THREE from 'three'
import type { Vehicle } from '../vehicles/Vehicle'
import { NitroFlames } from './NitroFlames'
import { SkidMarks } from './SkidMarks'
import { SurfaceSpray } from './SurfaceSpray'
import { TireSmoke } from './TireSmoke'

const _vel = new THREE.Vector3()

/**
 * Driving feedback for the player car: skid marks, tire smoke and sand / dust
 * spray in world space (`group`), nitro flames on the car model. Visual only — Game calls
 * `update` from render, reading the wheel state the last fixed tick left.
 */
export class DrivingEffects {
  readonly group = new THREE.Group()
  private readonly skidMarks = new SkidMarks()
  private readonly smoke = new TireSmoke()
  private readonly spray = new SurfaceSpray()
  private readonly flames: NitroFlames

  constructor(vehicle: Vehicle) {
    this.group.name = 'driving-effects'
    this.group.add(this.skidMarks.mesh, this.smoke.mesh, ...this.spray.meshes)
    this.flames = new NitroFlames(vehicle.config)
    // On the body, not the root: the body leans, and the pipes lean with it.
    vehicle.model.body.add(this.flames.group)
  }

  update(vehicle: Vehicle, dt: number): void {
    const ctrl = vehicle.controller
    const v = vehicle.body.linvel()
    _vel.set(v.x, v.y, v.z)
    this.skidMarks.update(ctrl.wheels, dt)
    this.smoke.update(ctrl.wheels, _vel, dt)
    this.spray.update(ctrl.wheels, _vel, dt)
    this.flames.update(ctrl.nitro.intensity, dt)
  }

  /** Wipe marks and smoke (new race, back to menu). */
  clear(): void {
    this.skidMarks.clear()
    this.smoke.clear()
    this.spray.clear()
    this.flames.update(0, 0)
  }

  dispose(): void {
    this.group.removeFromParent()
    this.skidMarks.dispose()
    this.smoke.dispose()
    this.spray.dispose()
    this.flames.dispose()
  }
}
