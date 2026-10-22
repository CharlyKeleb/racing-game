import type { QualityPreset } from '../stores/gameStore'
import type { AnyRenderer } from '../engine/Renderer'
import * as THREE from 'three'
import type { Vehicle } from '../vehicles/Vehicle'
import { NitroFlames, type ExhaustPop } from './NitroFlames'
import { NitroTrails } from './NitroTrails'
import { SkidMarks } from './SkidMarks'
import { SurfaceSpray } from './SurfaceSpray'
import { TireSmoke } from './TireSmoke'

const _vel = new THREE.Vector3()
const _fwd = new THREE.Vector3()
const _pop: ExhaustPop = { flash: 0, kind: 0, strength: 0, count: 0 }

/**
 * Driving feedback for the player car: skid marks, tire smoke and sand / dust
 * spray and nitro light trails in world space (`group`), nitro flames on the car model. Visual only — Game calls
 * `update` from render, reading the wheel state the last fixed tick left.
 */
export class DrivingEffects {
  readonly group = new THREE.Group()
  private readonly skidMarks = new SkidMarks()
  private readonly smoke = new TireSmoke()
  private readonly spray = new SurfaceSpray()
  private readonly flames: NitroFlames
  private readonly trails: NitroTrails

  constructor(vehicle: Vehicle) {
    this.group.name = 'driving-effects'
    this.group.add(this.smoke.mesh, ...this.spray.meshes)
    this.flames = new NitroFlames(vehicle.config)
    this.trails = new NitroTrails(vehicle.config)
    this.group.add(this.trails.mesh)
    // On the body, not the root: the body leans, and the pipes lean with it.
    vehicle.model.body.add(this.flames.group)
  }

  setQuality(quality: QualityPreset): void {
    this.smoke.setQuality(quality)
    this.spray.setQuality(quality)
    this.skidMarks.setQuality(quality)
  }

  update(vehicle: Vehicle, dt: number): void {
    const ctrl = vehicle.controller
    const v = vehicle.body.linvel()
    _vel.set(v.x, v.y, v.z)
    this.skidMarks.update(ctrl.wheels, dt)
    _fwd.set(0, 0, 1).applyQuaternion(vehicle.quaternion)
    this.smoke.update(ctrl.wheels, _vel, dt, ctrl.burnout.intensity, _fwd)
    this.spray.update(ctrl.wheels, _vel, dt)
    const b = ctrl.backfire
    _pop.flash = b.flash; _pop.kind = b.flashKind; _pop.strength = b.strength; _pop.count = b.count
    this.flames.update(ctrl.nitro.intensity, dt, _pop)
    if (NitroFlames.camera) this.trails.update(vehicle.model.body, NitroFlames.camera, ctrl.nitro.intensity, ctrl.nitro.perfect, dt)
  }

  renderMarks(renderer: AnyRenderer, position: THREE.Vector3): void {
    this.skidMarks.render(renderer, position)
  }

  /** Wipe marks and smoke (new race, back to menu). */
  clear(): void {
    this.skidMarks.clear()
    this.smoke.clear()
    this.spray.clear()
    this.flames.update(0, 0)
    this.trails.clear()
  }

  dispose(): void {
    this.group.removeFromParent()
    this.skidMarks.dispose()
    this.smoke.dispose()
    this.spray.dispose()
    this.flames.dispose()
    this.trails.dispose()
  }
}
