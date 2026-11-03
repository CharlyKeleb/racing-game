import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { expect, it } from 'vitest'
import { initRapier, PhysicsWorld } from '../src/engine/PhysicsWorld'
import { buildPlaceholderCar, rigCarModel } from '../src/vehicles/CarModel'
import { Vehicle } from '../src/vehicles/Vehicle'
import { planSafetyWalls } from '../src/world/SafetyWalls'

/**
 * Throws a car off the road at random points, speeds and angles, then drives
 * it back like a player would (steer for the road, reverse out of a wall).
 * Near the road it must never drop through the floor: Marina Bay's kerbs,
 * edge lines and pavements had no collision, and both tracks had cracks where
 * road and verge were simplified apart, which wheels dropped into and cars
 * sank through.
 */
it.each(['singapore', 'nurburgring', 'u2city', 'paris', 'canyon'])('%s: a car run off the road never falls through the floor', async (id) => {
  const { readFile } = await import('node:fs/promises')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js')
  const { StreamedTrack } = await import('../src/world/StreamedTrack')
  const { resolveVehicleConfig } = await import('../src/vehicles/VehicleConfig')
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  await initRapier()
  const physics = new PhysicsWorld()
  const assets = {
    loadJson: async (u: string) => JSON.parse(await readFile(`public${u}`, 'utf8')),
    loadBinary: async (u: string) => new Uint8Array(await readFile(`public${u}`)),
    loadGltf: async (u: string) => { const b = await readFile(`public${u}`); return loader.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '') },
  }
  const track = await StreamedTrack.load(`/models/tracks/${id}/track.json`, { assets: assets as never, world: physics.world, renderer: {} as THREE.WebGLRenderer, camera: new THREE.PerspectiveCamera(), scene: new THREE.Scene(), quality: 'low' })
  physics.step(1 / 60)
  const walls = planSafetyWalls(track.line, { floor: (x, y, z) => physics.floorHeight(x, y, z) })
  physics.world.createCollider(RAPIER.ColliderDesc.trimesh(walls.vertices, walls.indices), physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed()))
  physics.step(1 / 60)
  const config = resolveVehicleConfig(JSON.parse(await readFile('public/models/cars/porsche911/vehicle-config.json', 'utf8')))
  const car = new Vehicle(config, rigCarModel(buildPlaceholderCar(config), config), physics.world, track.spawn)
  car.controller.surfaceAt = (x, z) => track.surfaceAt(x, z)
  const line = track.line, n = line.length
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const falls: string[] = []
  try {
    for (let r = 0; r < 60; r++) {
      const i = Math.floor(rnd() * n), side = rnd() < 0.5 ? 1 : -1, angle = 0.3 + rnd() * 0.7, speed = 15 + rnd() * 40
      const p = line[i], a = line[(i - 1 + n) % n], b = line[(i + 1) % n], l = Math.hypot(b.x - a.x, b.z - a.z)
      const tx = (b.x - a.x) / l, tz = (b.z - a.z) / l, lx = tz * side, lz = -tx * side
      const dx = tx * Math.cos(angle) + lx * Math.sin(angle), dz = tz * Math.cos(angle) + lz * Math.sin(angle)
      car.respawn({ position: new THREE.Vector3(p.x, p.y + 0.8, p.z), heading: Math.atan2(dx, dz) })
      physics.step(1 / 60)
      car.body.setLinvel({ x: dx * speed, y: 0, z: dz * speed }, true)
      let slow = 0, backing = 0
      for (let s = 0; s < 60 * 6; s++) {
        slow = Math.abs(car.controller.forwardSpeed) < 2 && backing <= 0 ? slow + 1 : 0
        if (slow > 60) { backing = 90; slow = 0 }
        const input = backing-- > 0
          ? { throttle: 0, brake: 1, steer: side * 0.9, handbrake: false, nitro: false }
          : { throttle: s > 40 ? 0.8 : 1, brake: 0, steer: s > 40 ? -side * 0.8 : 0, handbrake: false, nitro: false }
        car.fixedUpdate(input, 1 / 60)
        physics.step(1 / 60)
        car.capture()
        const t = car.body.translation()
        let bi = 0, bd = Infinity
        for (let j = 0; j < n; j++) { const d = (line[j].x - t.x) ** 2 + (line[j].z - t.z) ** 2; if (d < bd) { bd = d; bi = j } }
        if (t.y - line[bi].y < -3) {
          if (Math.sqrt(bd) < 30) falls.push(`run ${r}: from line point ${i} side ${side}, fell at ${Math.sqrt(bd).toFixed(1)} m off line point ${bi}`)
          break
        }
      }
    }
  } finally { physics.dispose() }
  expect(falls).toEqual([])
}, 120000)
