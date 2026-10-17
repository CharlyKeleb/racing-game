import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it } from 'vitest'
import type { InputState } from '../src/input/InputManager'
import { fillRate, Nitro, type NitroInput } from '../src/vehicles/Nitro'
import { DEFAULT_VEHICLE_CONFIG, type NitroConfig } from '../src/vehicles/VehicleConfig'
import { VehicleController } from '../src/vehicles/VehicleController'

const DT = 1 / 60
const CFG: NitroConfig = {
  durationSec: 4,
  fillRate: 0.25,
  slipThreshold: 0.5,
  minFillSpeed: 10,
  minCharge: 0.2,
  force: 5000,
  topSpeedBonus: 0.2,
  rampRate: 5,
  airFillRate: 0.4,
  releaseGraceSec: 0.25,
  perfectWindowStart: 0.8,
  perfectWindowLength: 0.4,
  perfectDurationSec: 1.5,
  perfectBoost: 1.6,
  perfectDrainScale: 1.5,
}

const drifting: NitroInput = { slip: 1, speed: 30, grounded: true, airborne: false, wantsBoost: false }
const cruising: NitroInput = { slip: 0.2, speed: 30, grounded: true, airborne: false, wantsBoost: false }
const flying: NitroInput = { slip: 0, speed: 30, grounded: false, airborne: true, wantsBoost: false }
const held = (i: NitroInput): NitroInput => ({ ...i, wantsBoost: true })

function run(n: Nitro, input: NitroInput, seconds: number) {
  for (let i = 0; i < Math.round(seconds / DT); i++) n.update(input, DT)
}

describe('Nitro', () => {
  it('fills only past the slip threshold, above the minimum speed, on the ground', () => {
    expect(fillRate(cruising, CFG)).toBe(0)
    expect(fillRate({ ...drifting, speed: 5 }, CFG)).toBe(0)
    expect(fillRate({ ...drifting, grounded: false }, CFG)).toBe(0)
    expect(fillRate({ ...drifting, slip: 0.75 }, CFG)).toBeCloseTo(CFG.fillRate / 2)
    expect(fillRate(drifting, CFG)).toBeCloseTo(CFG.fillRate)
  })

  it('fills a full tank in 1/fillRate seconds of drifting and caps at 1', () => {
    const n = new Nitro(CFG)
    run(n, drifting, 2)
    expect(n.charge).toBeCloseTo(0.5, 2)
    run(n, drifting, 10)
    expect(n.charge).toBe(1)
  })

  it('needs minCharge to start a boost', () => {
    const n = new Nitro(CFG)
    n.charge = CFG.minCharge * 0.9
    n.update({ ...cruising, wantsBoost: true }, DT)
    expect(n.active).toBe(false)
    n.charge = CFG.minCharge
    n.update({ ...cruising, wantsBoost: true }, DT)
    expect(n.active).toBe(true)
  })

  it('drains a full tank in durationSec, then stops on its own', () => {
    const n = new Nitro(CFG)
    n.charge = 1
    run(n, { ...cruising, wantsBoost: true }, CFG.durationSec - 0.1)
    expect(n.active).toBe(true)
    expect(n.charge).toBeGreaterThan(0)
    run(n, { ...cruising, wantsBoost: true }, 0.2)
    expect(n.active).toBe(false)
    expect(n.charge).toBe(0)
  })

  it('stops once released past the grace period, and does not fill while boosting', () => {
    const n = new Nitro(CFG)
    n.charge = 1
    run(n, { ...drifting, wantsBoost: true }, 1)
    expect(n.charge).toBeCloseTo(1 - 1 / CFG.durationSec, 2)
    run(n, drifting, CFG.releaseGraceSec - 0.05)
    expect(n.active).toBe(true)
    run(n, drifting, 0.1)
    expect(n.active).toBe(false)
  })

  it('ramps intensity, force and drag in and out instead of stepping', () => {
    const n = new Nitro(CFG)
    n.charge = 1
    n.update({ ...cruising, wantsBoost: true }, DT)
    expect(n.intensity).toBeCloseTo(CFG.rampRate * DT)
    expect(n.force).toBeLessThan(CFG.force)
    run(n, { ...cruising, wantsBoost: true }, 1 / CFG.rampRate)
    expect(n.intensity).toBe(1)
    expect(n.force).toBe(CFG.force)
    // Drag scaled by 1/(1+b)² lifts the drag-limited top speed by b.
    expect(1 / Math.sqrt(n.dragScale)).toBeCloseTo(1 + CFG.topSpeedBonus)
    run(n, cruising, CFG.releaseGraceSec + 0.02 + 1 / CFG.rampRate)
    expect(n.intensity).toBe(0)
    expect(n.dragScale).toBe(1)
  })

  it('fills from airtime, but not when slow', () => {
    expect(fillRate(flying, CFG)).toBe(CFG.airFillRate)
    expect(fillRate({ ...flying, speed: 5 }, CFG)).toBe(0)
    const n = new Nitro(CFG)
    run(n, flying, 1)
    expect(n.charge).toBeCloseTo(CFG.airFillRate, 2)
  })

  /** Holds the button from a full tank for `seconds`, then taps (release 2 ticks, press). */
  function burnThenTap(seconds: number) {
    const n = new Nitro(CFG)
    n.charge = 1
    run(n, held(cruising), seconds)
    run(n, cruising, 2 * DT)
    n.update(held(cruising), DT)
    return n
  }

  it('opens a perfect window partway into the burn', () => {
    const n = new Nitro(CFG)
    n.charge = 1
    run(n, held(cruising), CFG.perfectWindowStart - 0.1)
    expect(n.windowOpen).toBe(false)
    expect(n.windowCue).toBeGreaterThan(0.5)
    run(n, held(cruising), 0.2)
    expect(n.windowOpen).toBe(true)
    run(n, held(cruising), CFG.perfectWindowLength)
    expect(n.windowOpen).toBe(false)
  })

  it('a tap inside the window fires a stronger, hungrier perfect boost', () => {
    const n = burnThenTap(CFG.perfectWindowStart + 0.1)
    expect(n.active).toBe(true)
    expect(n.perfect).toBe(true)
    expect(n.windowOpen).toBe(false)
    run(n, held(cruising), 0.5)
    expect(n.intensity).toBeCloseTo(CFG.perfectBoost)
    expect(n.force).toBeCloseTo(CFG.force * CFG.perfectBoost)
    // Drains perfectDrainScale times faster than a normal burn.
    const before = n.charge
    run(n, held(cruising), 0.5)
    expect(before - n.charge).toBeCloseTo((0.5 * CFG.perfectDrainScale) / CFG.durationSec, 2)
    // Then falls back to a normal boost while still held.
    run(n, held(cruising), CFG.perfectDurationSec - 1 + 0.05)
    expect(n.perfect).toBe(false)
    expect(n.active).toBe(true)
    run(n, held(cruising), 1 / CFG.rampRate)
    expect(n.intensity).toBeCloseTo(1)
  })

  it('a tap outside the window misses, and there is one try per burn', () => {
    const early = burnThenTap(0.3)
    expect(early.perfect).toBe(false)
    expect(early.missed).toBe(true)
    expect(early.active).toBe(true) // the re-tap within the grace kept the burn
    run(early, held(cruising), CFG.perfectWindowStart)
    expect(early.windowOpen).toBe(false)
    run(early, cruising, 2 * DT)
    early.update(held(cruising), DT)
    expect(early.perfect).toBe(false)

    const late = burnThenTap(CFG.perfectWindowStart + CFG.perfectWindowLength + 0.2)
    expect(late.perfect).toBe(false)
    expect(late.missed).toBe(true)
  })

  it('a new burn gets a fresh perfect window', () => {
    const n = burnThenTap(0.3)
    expect(n.missed).toBe(true)
    run(n, cruising, CFG.releaseGraceSec + 0.1)
    expect(n.active).toBe(false)
    run(n, held(cruising), CFG.perfectWindowStart + 0.1)
    expect(n.missed).toBe(false)
    expect(n.windowOpen).toBe(true)
  })

  it('reset empties the tank', () => {
    const n = new Nitro(CFG)
    n.charge = 1
    run(n, { ...cruising, wantsBoost: true }, 0.5)
    n.reset()
    expect([n.charge, n.active, n.intensity, n.perfect, n.missed]).toEqual([0, false, 0, false, false])
  })
})

describe('Nitro on the car', () => {
  beforeAll(() => RAPIER.init())

  function speedAfter(seconds: number, nitro: boolean, charge: number) {
    const cfg = DEFAULT_VEHICLE_CONFIG
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
    world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setDensity(0), body)
    const ctrl = new VehicleController(cfg, body, world)
    // Let the car settle on its springs and reach ~100 km/h before boosting.
    const input: InputState = { throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }
    while (ctrl.forwardSpeed < 100 / 3.6) {
      ctrl.update(input, DT)
      world.step()
    }
    ctrl.nitro.charge = charge
    input.nitro = nitro
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      ctrl.update(input, DT)
      world.step()
    }
    return { kmh: ctrl.forwardSpeed * 3.6, charge: ctrl.nitro.charge }
  }

  it('accelerates harder while boosting and spends the tank', () => {
    const plain = speedAfter(3, false, 1)
    const boosted = speedAfter(3, true, 1)
    expect(boosted.kmh).toBeGreaterThan(plain.kmh + 15)
    expect(boosted.charge).toBeLessThan(plain.charge)
  })

  it('does nothing with an empty tank', () => {
    const plain = speedAfter(2, false, 0)
    const boosted = speedAfter(2, true, 0)
    expect(boosted.kmh).toBeCloseTo(plain.kmh, 1)
  })
})
