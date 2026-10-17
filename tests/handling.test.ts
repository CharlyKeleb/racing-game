import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import type { InputState } from '../src/input/InputManager'
import { Surface } from '../src/vehicles/Surface'
import { DEFAULT_VEHICLE_CONFIG, type VehicleConfig } from '../src/vehicles/VehicleConfig'
import { VehicleController } from '../src/vehicles/VehicleController'

/**
 * Drives the real raycast car on a flat Rapier ground with keyboard-style
 * (on/off) inputs and checks that it handles smoothly: no yaw wobble in a
 * held turn and no lingering rotation after the wheel is released.
 */

const DT = 1 / 60

function spawnCar(cfg: VehicleConfig) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 1, 5000).setTranslation(0, -1, 0).setFriction(1), ground)
  const [hx, hy, hz] = cfg.chassisHalfExtents
  const m = cfg.massKg
  const [comX, comY, comZ] = cfg.centerOfMass
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(
        m,
        { x: comX, y: comY, z: comZ },
        { x: (m / 3) * (hy * hy + hz * hz), y: (m / 3) * (hx * hx + hz * hz), z: (m / 3) * (hx * hx + hy * hy) },
        { x: 0, y: 0, z: 0, w: 1 },
      )
      .setLinearDamping(0)
      .setAngularDamping(0.6)
      .setTranslation(0, 0.3, 0),
  )
  const [cx, cy, cz] = cfg.chassisCenter
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setDensity(0).setFriction(0.2), body)
  const ctrl = new VehicleController(cfg, body, world)
  const step = (input: InputState) => {
    ctrl.update(input, DT)
    world.timestep = DT
    world.step()
    return body.angvel().y * (180 / Math.PI)
  }
  return { ctrl, step, body }
}

const drive = (steer: number): InputState => ({ throttle: 1, brake: 0, steer, handbrake: false, nitro: false })

/** Accelerate in a straight line to ~120 km/h, then hold full right lock. */
function holdTurn(cfg: VehicleConfig) {
  const { ctrl, step } = spawnCar(cfg)
  while (ctrl.forwardSpeed < 120 / 3.6) step(drive(0))
  const turn: number[] = []
  for (let i = 0; i < 120; i++) turn.push(step(drive(1)))
  const release: number[] = []
  for (let i = 0; i < 60; i++) release.push(step(drive(0)))
  return { turn, release }
}

describe('handling smoothness', () => {
  beforeAll(() => RAPIER.init())

  it('settles into a held turn without yaw wobble', () => {
    const { turn } = holdTurn(DEFAULT_VEHICLE_CONFIG)
    // After turn-in, yaw rate should decay monotonically toward a steady value.
    const settled = turn.slice(40)
    let reversals = 0
    for (let i = 2; i < settled.length; i++) {
      const a = settled[i - 1] - settled[i - 2]
      const b = settled[i] - settled[i - 1]
      if (a * b < 0 && Math.abs(b) > 0.05) reversals++
    }
    expect(reversals).toBeLessThanOrEqual(1)
    const peak = Math.max(...turn.map(Math.abs))
    const steady = Math.abs(turn[turn.length - 1])
    expect(peak / steady).toBeLessThan(1.6)
  })

  it('stops rotating soon after the steering is released', () => {
    const { release } = holdTurn(DEFAULT_VEHICLE_CONFIG)
    expect(Math.abs(release[30])).toBeLessThan(2) // within 0.5 s
  })

  it('drives forward again after reversing', () => {
    const { ctrl, step } = spawnCar(DEFAULT_VEHICLE_CONFIG)
    const pedals = (throttle: number, brake: number): InputState => ({ throttle, brake, steer: 0, handbrake: false, nitro: false })
    for (let i = 0; i < 30; i++) step(pedals(0, 0)) // settle on the springs
    for (let i = 0; i < 120; i++) step(pedals(0, 1))
    expect(ctrl.drivetrain.gear).toBe(-1)
    expect(ctrl.forwardSpeed).toBeLessThan(-1)
    // Throttle in reverse brakes first, then must engage 1st and pull away.
    for (let i = 0; i < 240; i++) step(pedals(1, 0))
    expect(ctrl.drivetrain.gear).toBeGreaterThan(0)
    expect(ctrl.forwardSpeed).toBeGreaterThan(5)
  })

  it('is calmer than with the assist switched off', () => {
    const assisted = holdTurn(DEFAULT_VEHICLE_CONFIG)
    const raw = holdTurn({ ...DEFAULT_VEHICLE_CONFIG, yawStability: 0 })
    const residual = (r: number[]) => Math.abs(r[30])
    expect(residual(assisted.release)).toBeLessThan(residual(raw.release))
  })

  it('holds a countersteered drift that a full-strength assist would straighten', () => {
    /** Handbrake flick at ~90 km/h, then opposite lock on throttle; returns the body slip angle (deg). */
    const driftAngle = (cfg: VehicleConfig) => {
      const { ctrl, step, body } = spawnCar(cfg)
      while (ctrl.forwardSpeed < 90 / 3.6) step(drive(0))
      for (let i = 0; i < 40; i++) step({ throttle: 0, brake: 0, steer: 1, handbrake: true, nitro: false })
      for (let i = 0; i < 40; i++) step({ throttle: 0.7, brake: 0, steer: -0.5, handbrake: false, nitro: false })
      const v = body.linvel()
      const q = body.rotation()
      // Car forward (+Z) and right (−X) rotated by the body quaternion, in the XZ plane.
      const fx = 2 * (q.x * q.z + q.w * q.y)
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
      const along = v.x * fx + v.z * fz
      const across = v.x * fz - v.z * fx
      return (Math.atan2(Math.abs(across), Math.abs(along)) * 180) / Math.PI
    }
    const drifty = driftAngle({ ...DEFAULT_VEHICLE_CONFIG, driftAssist: 0.2 })
    const strict = driftAngle({ ...DEFAULT_VEHICLE_CONFIG, driftAssist: 1 })
    expect(drifty).toBeGreaterThan(15) // still well sideways after 2/3 s of opposite lock
    expect(drifty).toBeGreaterThan(strict + 4)
  })

  it('a gravel trap brings the car to a stop far sooner than tarmac', () => {
    const coastDistance = (surface: Surface) => {
      const { ctrl, step } = spawnCar(DEFAULT_VEHICLE_CONFIG)
      while (ctrl.forwardSpeed < 100 / 3.6) step(drive(0))
      ctrl.surfaceAt = () => surface
      let d = 0
      for (let i = 0; i < 60 * 8 && ctrl.forwardSpeed > 1; i++) {
        step({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false })
        d += ctrl.forwardSpeed * DT
      }
      return { d, speed: ctrl.forwardSpeed }
    }
    const sand = coastDistance(Surface.Sand)
    const road = coastDistance(Surface.Asphalt)
    expect(sand.speed).toBeLessThan(1) // stopped within 8 s
    expect(sand.d).toBeLessThan(90)
    expect(road.d).toBeGreaterThan(sand.d * 2)
  })
})
