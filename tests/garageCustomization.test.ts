import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { rigCarModel } from '../src/vehicles/CarModel'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import { DEFAULT_LIVERY, sanitizeLivery } from '../src/vehicles/LiveryDesign'
import { ChaseCamera } from '../src/camera/ChaseCamera'
import { DEFAULT_BUILD, sanitizeBuild } from '../src/vehicles/CarBuild'

it('fits offset exporter meshes to configured wheel dimensions without changing shared geometry', () => {
  const scene = new THREE.Group()
  const geometry = new THREE.BoxGeometry(.2, .6, .6)
  geometry.translate(.03, -.07, .04)
  const original = Array.from(geometry.getAttribute('position').array)
  for (const wheel of DEFAULT_VEHICLE_CONFIG.wheels) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    mesh.name = `Wheel_${wheel.id}`
    mesh.scale.set(1.3, .8, 1.1)
    mesh.position.set(...wheel.position)
    scene.add(mesh)
  }
  const model = rigCarModel(scene, DEFAULT_VEHICLE_CONFIG)
  model.root.updateMatrixWorld(true)
  for (const wheel of DEFAULT_VEHICLE_CONFIG.wheels) {
    const box = new THREE.Box3().setFromObject(model.wheels[wheel.id].spinner, true)
    const size = box.getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(wheel.width)
    expect(size.y).toBeCloseTo(wheel.radius * 2)
    expect(size.z).toBeCloseTo(wheel.radius * 2)
    expect(box.getCenter(new THREE.Vector3()).length()).toBeLessThan(.00001)
  }
  expect(Array.from(geometry.getAttribute('position').array)).toEqual(original)
})

describe('livery save compatibility', () => {
  it('loads older builds with stock livery and plates disabled', () => {
    expect(sanitizeBuild({ paint: '#123456' }).livery).toEqual(DEFAULT_LIVERY)
  })
  it('roundtrips plate and livery choices in a complete build', () => {
    const livery = { ...DEFAULT_LIVERY, pattern: 'sash', plateEnabled: true, plateText: 'GT 123', plateStyle: 'heritage' } as const
    expect(sanitizeBuild(JSON.parse(JSON.stringify({ ...DEFAULT_BUILD, livery }))).livery).toEqual(livery)
  })
  it('normalizes plate text and rejects malformed saved options', () => {
    expect(sanitizeLivery({ plateText: 'ab<script>12', plateStyle: 'bad', number: Infinity })).toMatchObject({
      plateText: 'ABSCRIPT', plateStyle: DEFAULT_LIVERY.plateStyle, number: DEFAULT_LIVERY.number,
    })
  })
})

it('keeps the car outside the near plane throughout a close-up to full-car transition', () => {
  const camera = new THREE.PerspectiveCamera(34, 1.6, .1, 1000)
  const controller = new ChaseCamera(camera)
  const anchor = new THREE.Group()
  camera.position.set(0, .6, -4.2)
  const framing = { focus: new THREE.Vector3(0, .55, 0), distance: 6, height: 1.5, shift: 1.2, fov: 45 }
  for (let frame = 0; frame < 120; frame++) {
    controller.showroom(anchor, Math.PI, 1 / 60, framing)
    const clearance = Math.max(.1, camera.position.distanceTo(anchor.position) - 3)
    expect(camera.near).toBeLessThanOrEqual(clearance + .011)
  }
  expect(camera.near).toBeCloseTo(1.6)
})
