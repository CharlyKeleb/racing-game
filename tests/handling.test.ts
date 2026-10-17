import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import type { InputState } from '../src/input/InputManager'
import { Surface } from '../src/vehicles/Surface'
import { DEFAULT_VEHICLE_CONFIG, resolveVehicleConfig, type VehicleConfig } from '../src/vehicles/VehicleConfig'
import { VehicleController } from '../src/vehicles/VehicleController'
import porsche911Json from '../public/models/cars/porsche911/vehicle-config.json'

/**
 * Drives the real raycast car on a flat Rapier ground with keyboard-style
 * (on/off) inputs and checks that it handles smoothly: no yaw wobble in a
 * held turn and no lingering rotation after the wheel is released.
 */

const DT = 1 / 60

/** The shipped 911, resolved over the defaults exactly as the game loads it. */
const PORSCHE_911 = resolveVehicleConfig(porsche911Json as Partial<VehicleConfig>)
const CARS: [string, VehicleConfig][] = [
  ['default (McLaren)', DEFAULT_VEHICLE_CONFIG],
  ['Porsche 911', PORSCHE_911],
]

/** Body slip angle, degrees: how far the velocity points away from the nose (XZ plane). */
function slipAngle(body: RAPIER.RigidBody): number {
  const v = body.linvel()
  const q = body.rotation()
  const fx = 2 * (q.x * q.z + q.w * q.y)
  const fz = 1 - 2 * (q.x * q.x + q.y * q.y)
  return (Math.atan2(Math.abs(v.x * fz - v.z * fx), Math.abs(v.x * fx + v.z * fz)) * 180) / Math.PI
}

const pedals = (p: Partial<InputState>): InputState => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...p })

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

describe.each(CARS)('handling smoothness: %s', (_, cfg) => {
  beforeAll(() => RAPIER.init())

  it('settles into a held turn without yaw wobble', () => {
    const { turn } = holdTurn(cfg)
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
    const { release } = holdTurn(cfg)
    expect(Math.abs(release[30])).toBeLessThan(2) // within 0.5 s
  })
})

describe('handling', () => {
  beforeAll(() => RAPIER.init())

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

/**
 * The 911 Carrera 4S: rear-engined AWD. It should feel planted — no snap on
 * power or on lift-off — yet rotate into a holdable slide on the handbrake.
 */
describe('Porsche 911 handling', () => {
  beforeAll(() => RAPIER.init())

  /** Most sideways the car gets over 2 s of full throttle out of a 60 km/h corner. */
  const powerExitSlip = (cfg: VehicleConfig) => {
    const { ctrl, step, body } = spawnCar(cfg)
    while (ctrl.forwardSpeed < 60 / 3.6) step(pedals({ throttle: 1 }))
    let max = 0
    for (let i = 0; i < 120; i++) {
      step(pedals({ throttle: 1, steer: 0.6 }))
      max = Math.max(max, slipAngle(body))
    }
    return max
  }

  it('stays planted on power out of a corner', () => {
    expect(powerExitSlip(PORSCHE_911)).toBeLessThan(8)
  })

  it('stays planted across the AWD split range (frontDriveShare 0.25–0.45)', () => {
    for (const frontDriveShare of [0.25, 0.35, 0.45]) {
      expect(powerExitSlip({ ...PORSCHE_911, frontDriveShare })).toBeLessThan(8)
    }
  })

  it("doesn't snap round when lifting off mid-corner", () => {
    const { ctrl, step, body } = spawnCar(PORSCHE_911)
    while (ctrl.forwardSpeed < 120 / 3.6) step(pedals({ throttle: 1 }))
    for (let i = 0; i < 60; i++) step(pedals({ throttle: 0.5, steer: 0.7 }))
    const before = slipAngle(body)
    let max = 0
    for (let i = 0; i < 60; i++) {
      step(pedals({ steer: 0.7 }))
      max = Math.max(max, slipAngle(body))
    }
    expect(max - before).toBeLessThan(2)
  })

  it('drifts on the handbrake, holds it on opposite lock, then recovers', () => {
    const { ctrl, step, body } = spawnCar(PORSCHE_911)
    while (ctrl.forwardSpeed < 90 / 3.6) step(pedals({ throttle: 1 }))
    for (let i = 0; i < 40; i++) step(pedals({ steer: 1, handbrake: true }))
    expect(slipAngle(body)).toBeGreaterThan(12)
    for (let i = 0; i < 40; i++) step(pedals({ throttle: 0.7, steer: -0.5 }))
    expect(slipAngle(body)).toBeGreaterThan(15) // still sideways: the slide holds
    let t = 0
    while (slipAngle(body) > 3 && t < 240) {
      step(pedals({ throttle: 0.4 }))
      t++
    }
    // Straightens up once the driver lets it. The drift now holds ~34° on opposite
    // lock (the assist used to pull it back to ~20°), and unwinding that on full
    // grip takes ~1.6 s of plain tire physics.
    expect(t / 60).toBeLessThan(1.8)
  })

  /** Peak body slip (deg) over `frames` of `input` after reaching `kmh` in a straight line. */
  const slideAfter = (kmh: number, setup: [number, Partial<InputState>][], frames: number, input: Partial<InputState>) => {
    const { ctrl, step, body } = spawnCar(PORSCHE_911)
    while (ctrl.forwardSpeed < kmh / 3.6) step(pedals({ throttle: 1 }))
    for (const [n, p] of setup) for (let i = 0; i < n; i++) step(pedals(p))
    let max = 0
    for (let i = 0; i < frames; i++) {
      step(pedals(input))
      max = Math.max(max, slipAngle(body))
    }
    return { max, end: slipAngle(body), ctrl }
  }

  it("stays gripped on a fast full-lock turn-in: no drift unless asked for", () => {
    const { max } = slideAfter(160, [], 90, { throttle: 1, steer: 1 })
    expect(max).toBeLessThan(8)
  })

  it('stays gripped braking then turning in hard (keyboard: full lock)', () => {
    const { max } = slideAfter(110, [[10, { brake: 1 }], [2, {}]], 90, { throttle: 0.8, steer: 1 })
    expect(max).toBeLessThan(8)
  })

  it('with autoEntries on, a brake-tap entry drifts and the assist still catches a spin', () => {
    const cfg = { ...PORSCHE_911, drift: { ...PORSCHE_911.drift, autoEntries: true } }
    const { ctrl, step, body } = spawnCar(cfg)
    while (ctrl.forwardSpeed < 110 / 3.6) step(pedals({ throttle: 1 }))
    for (let i = 0; i < 10; i++) step(pedals({ brake: 1 }))
    for (let i = 0; i < 2; i++) step(pedals({}))
    let max = 0
    for (let i = 0; i < 90; i++) {
      step(pedals({ throttle: 0.8, steer: 1 }))
      max = Math.max(max, slipAngle(body))
    }
    expect(max).toBeGreaterThan(12)
    expect(max).toBeLessThan(60)
  })

  it('stays gripped turning in at the same speed without an entry', () => {
    const { max } = slideAfter(110, [], 90, { throttle: 0.8, steer: 1 })
    expect(max).toBeLessThan(8)
  })

  it('accelerates and brakes like the real car', () => {
    const { ctrl, step } = spawnCar(PORSCHE_911)
    let t = 0
    while (ctrl.forwardSpeed < 100 / 3.6) {
      step(pedals({ throttle: 1 }))
      t++
    }
    expect(t / 60).toBeGreaterThan(3) // Carrera 4S: 0–100 km/h in 3.6 s
    expect(t / 60).toBeLessThan(4.2)
    let stop = 0
    while (ctrl.forwardSpeed > 0.5) {
      step(pedals({ brake: 1 }))
      stop++
    }
    expect(stop / 60).toBeLessThan(2.8) // ~1.1 g
  })

  it('smokes the tires braking hard from high speed, not from low speed', () => {
    /** Peak tire slide (m/s) in the first second of full braking from `kmh`. */
    const brakeSlide = (kmh: number) => {
      const { ctrl, step } = spawnCar(PORSCHE_911)
      while (ctrl.forwardSpeed < kmh / 3.6) step(pedals({ throttle: 1 }))
      let max = 0
      for (let i = 0; i < 60; i++) {
        step(pedals({ brake: 1 }))
        for (const w of ctrl.wheels) max = Math.max(max, w.slide)
      }
      return max
    }
    expect(brakeSlide(200)).toBeGreaterThan(4) // TireSmoke starts at 2.5 m/s
    expect(brakeSlide(60)).toBeLessThan(2.5)
  })
})
