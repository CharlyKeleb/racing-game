import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { makeImpactPCM } from '../src/audio/ImpactPCM'
import { FeedbackSpring } from '../src/effects/FeedbackSpring'
import { ChaseCamera } from '../src/camera/ChaseCamera'
import { Vehicle } from '../src/vehicles/Vehicle'
import { buildPlaceholderCar, rigCarModel } from '../src/vehicles/CarModel'
import { DEFAULT_VEHICLE_CONFIG as cfg } from '../src/vehicles/VehicleConfig'

describe('impact assets', () => {
  it('keeps every variant finite, below full scale, and fades its tail', () => {
    for (const kind of ['wall', 'car', 'ground', 'curb'] as const) for (const strength of [.25, .6, 1]) {
      const data = makeImpactPCM(kind, strength, 731, 24000)
      let peak = 0, tail = 0
      for (let i = 0; i < data.length; i++) { expect(Number.isFinite(data[i])).toBe(true); peak = Math.max(peak, Math.abs(data[i])); if (i > data.length - 100) tail = Math.max(tail, Math.abs(data[i])) }
      expect(peak).toBeCloseTo(.82, 4)
      expect(tail).toBeLessThan(.02)
    }
  })
  it('varies the contact texture and makes wheel strikes shorter than crashes', () => {
    const a = makeImpactPCM('wall', 1, 1), b = makeImpactPCM('wall', 1, 2)
    let difference = 0
    for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i])
    expect(difference / a.length).toBeGreaterThan(.01)
    expect(makeImpactPCM('curb', 1).length).toBeLessThan(a.length / 2)
  })
})

describe('visual feedback springs', () => {
  it('settles after an impulse at different frame rates and freezes while paused', () => {
    for (const rate of [20, 60, 144]) {
      const spring = new FeedbackSpring(18, .7)
      spring.velocity = 1
      let peak = 0
      for (let i = 0; i < rate * 2; i++) peak = Math.max(peak, Math.abs(spring.step(0, 1 / rate)))
      expect(peak).toBeGreaterThan(.015)
      expect(peak).toBeLessThan(.05)
      expect(Math.abs(spring.value)).toBeLessThan(.0001)
      spring.velocity = 1
      const before = spring.value
      expect(spring.step(1, 0)).toBe(before)
      spring.reset(); expect(spring.velocity).toBe(0)
    }
  })
  it('widens and pulls back progressively, without low-speed buzz', () => {
    const cam = new THREE.PerspectiveCamera(58), rig = new ChaseCamera(cam), car = new THREE.Object3D()
    for (let i = 0; i < 120; i++) rig.update(car, 0, 1 / 60)
    const still = cam.position.clone(), fov = cam.fov
    rig.update(car, 0, 1 / 60)
    expect(cam.position.distanceTo(still)).toBeLessThan(1e-8)
    for (let i = 0; i < 120; i++) rig.update(car, 180, 1 / 60)
    expect(cam.fov).toBeGreaterThan(fov + 8)
    expect(cam.position.z).toBeLessThan(still.z - .3)
    expect(cam.fov).toBeLessThan(74)
  })
  it('settles after a hit and clears transient feedback on camera snap', () => {
    const cam = new THREE.PerspectiveCamera(58), rig = new ChaseCamera(cam), car = new THREE.Object3D()
    rig.update(car, 0, 1 / 60)
    const base = cam.position.clone()
    rig.jolt(1)
    rig.update(car, 0, 1 / 60)
    expect(cam.position.distanceTo(base)).toBeGreaterThan(.005)
    for (let i = 0; i < 120; i++) rig.update(car, 0, 1 / 60)
    expect(cam.position.distanceTo(base)).toBeLessThan(.0001)
    rig.jolt(1); rig.snap(); rig.update(car, 0, 1 / 60)
    expect(cam.position.distanceTo(base)).toBeLessThan(.0001)
  })
})

describe('vehicle suspension presentation', () => {
  beforeAll(() => RAPIER.init())
  it('responds to compression without moving the physics body, freezes and resets', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
    const spawn = { position: new THREE.Vector3(0, 1, 0), heading: 0 }
    const vehicle = new Vehicle(cfg, rigCarModel(buildPlaceholderCar(cfg), cfg), world, spawn)
    vehicle.motion.suspensionVelocity = 2
    vehicle.motion.accelLong = -8
    for (let i = 0; i < 20; i++) vehicle.render(1, 1 / 60)
    expect(vehicle.model.body.rotation.x).toBeGreaterThan(.01)
    expect(vehicle.model.body.position.y).toBeLessThan(0)
    expect(vehicle.body.translation().y).toBe(1)
    const before = vehicle.model.body.position.clone()
    vehicle.render(1, 0)
    expect(vehicle.model.body.position.distanceTo(before)).toBe(0)
    vehicle.respawn(spawn)
    expect(vehicle.model.body.position.length()).toBe(0)
    expect(vehicle.motion.roadRoughness).toBe(0)
    vehicle.disposeMaterials(); world.free()
  })
})
