import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import type { InputState } from '../src/input/InputManager'
import { Burnout, type BurnoutInput } from '../src/vehicles/Burnout'
import { DEFAULT_VEHICLE_CONFIG, resolveVehicleConfig, type VehicleConfig } from '../src/vehicles/VehicleConfig'
import { VehicleController } from '../src/vehicles/VehicleController'
import porsche911Json from '../public/models/cars/porsche911/vehicle-config.json'
import { tyreBrakeLevels } from '../src/audio/TyreBrakeModel'
import { getCar } from '../src/vehicles/carRegistry'

const DT = 1 / 60
const held: BurnoutInput = { throttle: 1, brake: 1, handbrake: false, speed: 0, forward: true, grounded: true }
const run = (b: Burnout, s: Partial<BurnoutInput>, seconds: number) => { for (let t = 0; t < seconds; t += DT) b.update(DT, { ...held, ...s }) }

describe('burnout', () => {
  it('spins up with brake and full throttle at a standstill, and pins the car', () => {
    const b = new Burnout()
    run(b, {}, 0.5)
    expect(b.holding).toBe(true)
    expect(b.intensity).toBe(1)
  })

  it('needs both pedals, no handbrake, a forward gear, the ground and a standstill', () => {
    for (const s of [{ throttle: 0.3 }, { brake: 0 }, { handbrake: true }, { forward: false }, { grounded: false }, { speed: 10 }]) {
      const b = new Burnout()
      run(b, s, 1)
      expect(b.holding, JSON.stringify(s)).toBe(false)
      expect(b.intensity).toBe(0)
    }
  })

  it('launching out of it (brake off, throttle on) keeps the smoke going briefly, then it winds down', () => {
    const b = new Burnout()
    run(b, {}, 0.5)
    run(b, { brake: 0, speed: 5 }, 0.3)
    expect(b.holding).toBe(false)
    expect(b.intensity).toBeGreaterThan(0.4)
    run(b, { brake: 0, speed: 15 }, 0.5)
    expect(b.intensity).toBe(0)
  })

  it('lifting off stops it faster than launching', () => {
    const lift = new Burnout(), launch = new Burnout()
    run(lift, {}, 0.5); run(launch, {}, 0.5)
    run(lift, { throttle: 0, brake: 0 }, 0.2)
    run(launch, { brake: 0, speed: 5 }, 0.2)
    expect(lift.intensity).toBeLessThan(launch.intensity)
  })

  it('reset clears it', () => {
    const b = new Burnout()
    run(b, {}, 0.5)
    b.reset()
    expect(b.intensity).toBe(0)
    expect(b.holding).toBe(false)
  })
})

const pedals = (p: Partial<InputState>): InputState => ({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, ...p })

function spawn(cfg: VehicleConfig) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.cuboid(500, 1, 500).setTranslation(0, -1, 0).setFriction(1), ground)
  const [hx, hy, hz] = cfg.chassisHalfExtents, m = cfg.massKg, [comX, comY, comZ] = cfg.centerOfMass
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setAdditionalMassProperties(m, { x: comX, y: comY, z: comZ }, { x: (m / 3) * (hy * hy + hz * hz), y: (m / 3) * (hx * hx + hz * hz), z: (m / 3) * (hx * hx + hy * hy) }, { x: 0, y: 0, z: 0, w: 1 })
    .setAngularDamping(0.6).setTranslation(0, 0.3, 0))
  const [cx, cy, cz] = cfg.chassisCenter
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setDensity(0).setFriction(0.2), body)
  const ctrl = new VehicleController(cfg, body, world)
  const step = (input: InputState, seconds: number) => {
    for (let t = 0; t < seconds; t += DT) { ctrl.update(input, DT); world.timestep = DT; world.step() }
  }
  return { ctrl, step, body }
}

describe('burnout in the car', () => {
  beforeAll(() => RAPIER.init())
  const PORSCHE = resolveVehicleConfig(porsche911Json as Partial<VehicleConfig>)

  for (const [name, cfg] of [['RWD default', DEFAULT_VEHICLE_CONFIG], ['AWD Porsche 911', PORSCHE]] as const) {
    it(`${name}: holds the car, spins and smokes the rear tyres (not the fronts), and revs`, () => {
      const { ctrl, step, body } = spawn(cfg)
      step(pedals({}), 1) // settle
      step(pedals({ throttle: 1, brake: 1 }), 2)
      expect(ctrl.burnout.intensity).toBe(1)
      expect(Math.abs(ctrl.forwardSpeed)).toBeLessThan(0.5)
      expect(Math.hypot(body.translation().x, body.translation().z)).toBeLessThan(1)
      const rear = ctrl.wheels.filter((w) => w.cfg.position[2] < 0), front = ctrl.wheels.filter((w) => w.cfg.position[2] > 0)
      for (const w of rear) expect(w.slide).toBeGreaterThan(12) // full smoke (TireSmoke SLIDE_FULL)
      for (const w of front) expect(w.slide).toBeLessThan(2.5) // below smoke start
      expect(ctrl.drivetrain.rpm).toBeGreaterThan(cfg.engine.redlineRpm * 0.7)
      expect(ctrl.drivetrain.gear).toBe(1)
    })
  }

  it('brake first, then throttle, still burns out instead of reversing away', () => {
    const { ctrl, step } = spawn(DEFAULT_VEHICLE_CONFIG)
    step(pedals({}), 1)
    step(pedals({ brake: 1 }), 0.3) // stopped with brake: the box goes to reverse...
    step(pedals({ throttle: 1, brake: 1 }), 1.5) // ...but both pedals ask for 1st
    expect(ctrl.drivetrain.gear).toBe(1)
    expect(ctrl.burnout.holding).toBe(true)
    expect(ctrl.forwardSpeed).toBeGreaterThan(-0.5)
  })

  it('launches when the brake comes off, smoke trailing as it pulls away', () => {
    const { ctrl, step } = spawn(DEFAULT_VEHICLE_CONFIG)
    step(pedals({}), 1)
    step(pedals({ throttle: 1, brake: 1 }), 1.5)
    step(pedals({ throttle: 1 }), 0.25)
    expect(ctrl.forwardSpeed).toBeGreaterThan(1)
    expect(Math.max(...ctrl.wheels.map((w) => w.slide))).toBeGreaterThan(2.5)
    step(pedals({ throttle: 1 }), 2)
    expect(ctrl.burnout.intensity).toBe(0)
    expect(ctrl.forwardSpeed).toBeGreaterThan(8)
  })
})

describe('burnout sound', () => {
  it('the tyres squeal with the car standing still, and stay quiet when nothing slides', () => {
    const noise = getCar('porsche911').noise
    const base = { speed: 0, brake: 1, slip: 1, slide: 16, paved: 1, drifting: false, kerb: 0 }
    expect(tyreBrakeLevels(base, noise).squeal + tyreBrakeLevels(base, noise).scrub).toBeGreaterThan(0.5)
    expect(tyreBrakeLevels({ ...base, slide: 0, slip: 0 }, noise).squeal).toBe(0)
  })
})
