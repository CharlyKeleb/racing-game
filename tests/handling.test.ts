import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import type { InputState } from '../src/input/InputManager'
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
      .setLinearDamping(0.02)
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
  return { ctrl, step }
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

  it('is calmer than with the assist switched off', () => {
    const assisted = holdTurn(DEFAULT_VEHICLE_CONFIG)
    const raw = holdTurn({ ...DEFAULT_VEHICLE_CONFIG, yawStability: 0 })
    const residual = (r: number[]) => Math.abs(r[30])
    expect(residual(assisted.release)).toBeLessThan(residual(raw.release))
  })
})
