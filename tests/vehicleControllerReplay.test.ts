import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, expect, it } from 'vitest'
import { initRapier } from '../src/engine/PhysicsWorld'
import type { InputState } from '../src/input/InputManager'
import { DEFAULT_VEHICLE_CONFIG as config } from '../src/vehicles/VehicleConfig'
import { VehiclePhysics } from '../src/vehicles/VehiclePhysics'
import { VehicleController } from '../src/vehicles/VehicleController'
const dt = 1 / 60
beforeAll(() => initRapier())
function world() {
  const result = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  result.timestep = dt
  result.createCollider(RAPIER.ColliderDesc.cuboid(1000, .1, 1000).setTranslation(0, -.1, 0))
  return result
}
const inputAt = (tick: number): InputState => ({ throttle: tick % 180 < 140 ? 1 : .1,
  brake: tick % 180 < 10 || tick % 180 > 150 ? .9 : 0, steer: tick % 240 < 120 ? .35 : -.3,
  steerSource: tick % 100 < 50 ? 'keyboard' : 'analog', handbrake: tick % 180 >= 85 && tick % 180 < 95,
  nitro: tick % 200 < 90 })
function advance(controller: VehicleController, body: RAPIER.RigidBody, world: RAPIER.World, tick: number) {
  controller.update(inputAt(tick), dt)
  world.step()
  return { position: body.translation(), rotation: body.rotation(),
    velocity: body.linvel(), angular: body.angvel(), state: controller.captureState() }
}
it('restores controller timers plus a Rapier world checkpoint and reproduces subsequent physics exactly', () => {
  const original = world()
  const car = new VehiclePhysics(config, original, { position: { x: 0, y: .3, z: 0 }, heading: 0 }, true)
  try {
    car.controller.nitro.charge = 1
    car.controller.setDriftMode(true)
    for (let tick = 0; tick < 420; tick++) {
      if ([28, 88, 164, 237, 351].includes(tick)) {
        const controllerState = JSON.parse(JSON.stringify(car.controller.captureState()))
        const restored = RAPIER.World.restoreSnapshot(original.takeSnapshot())
        try {
          const body = restored.getRigidBody(car.body.handle)
          const branch = new VehicleController(config, body, restored, true)
          branch.restoreState(controllerState)
          // Compare the original continuing normally with the restored branch, not two resets.
          for (let ahead = 0; ahead < 12; ahead++, tick++) {
            expect(advance(branch, body, restored, tick)).toEqual(advance(car.controller, car.body, original, tick))
          }
          tick--
        } finally { restored.free() }
      } else advance(car.controller, car.body, original, tick)
    }
  } finally { original.free() }
})
it('copies nested state without retaining mutable wheel vectors, arrays or checkpoint objects', () => {
  const w = world(), car = new VehiclePhysics(config, w, { position: { x: 0, y: .3, z: 0 }, heading: 0 }, true)
  try {
    for (let tick = 0; tick < 90; tick++) advance(car.controller, car.body, w, tick)
    const state = car.controller.captureState(), frozen = JSON.stringify(state)
    for (let tick = 90; tick < 100; tick++) advance(car.controller, car.body, w, tick)
    expect(JSON.stringify(state)).toBe(frozen)
    car.controller.restoreState(state)
    state.wheels[0].contactPoint.x += 100
    state.wheels[0].suspension.compression += 100
    state.nitro.charge = 99
    expect(car.controller.wheels[0].contactPoint.x).not.toBe(state.wheels[0].contactPoint.x)
    expect(car.controller.wheels[0].suspension.compression).not.toBe(state.wheels[0].suspension.compression)
    expect(car.controller.nitro.charge).not.toBe(99)
    const current = car.controller.captureState()
    expect(() => car.controller.restoreState({ ...current, version: 2 } as never)).toThrow('Incompatible')
    expect(() => car.controller.restoreState({ ...current, wheels: [] })).toThrow('Incompatible')
    expect(car.controller.captureState()).toEqual(current)
  } finally { w.free() }
})

it('restores two ghost racers in one world without cross-car controller state or changed update order', () => {
  const original = world()
  const cars = [-2, 2].map(x => new VehiclePhysics(config, original, { position: { x, y: .3, z: 0 }, heading: 0 }, true))
  let restored: RAPIER.World | undefined
  try {
    for (let tick = 0; tick < 150; tick++) {
      cars.forEach((car, index) => car.controller.update(inputAt(tick + index * 70), dt))
      original.step()
    }
    const checkpoints = cars.map(car => JSON.parse(JSON.stringify(car.controller.captureState())))
    restored = RAPIER.World.restoreSnapshot(original.takeSnapshot())
    const branches = cars.map((car, index) => {
      const body = restored!.getRigidBody(car.body.handle), controller = new VehicleController(config, body, restored!, true)
      controller.restoreState(checkpoints[index])
      return { body, controller }
    })
    for (let tick = 150; tick < 270; tick++) {
      cars.forEach((car, index) => car.controller.update(inputAt(tick + index * 70), dt))
      branches.forEach((car, index) => car.controller.update(inputAt(tick + index * 70), dt))
      original.step(); restored.step()
      cars.forEach((car, index) => {
        expect(branches[index].body.translation()).toEqual(car.body.translation())
        expect(branches[index].body.rotation()).toEqual(car.body.rotation())
        expect(branches[index].body.linvel()).toEqual(car.body.linvel())
        expect(branches[index].controller.captureState()).toEqual(car.controller.captureState())
      })
    }
  } finally { restored?.free(); original.free() }
})
