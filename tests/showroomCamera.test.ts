import { expect, it } from 'vitest'
import * as THREE from 'three'
import { ChaseCamera } from '../src/camera/ChaseCamera'

it('preserves the camera view relative to the garage when switching track origins', () => {
  const camera = new THREE.PerspectiveCamera(42)
  const rig = new ChaseCamera(camera)
  const from = new THREE.Object3D()
  from.position.set(12, 2, -20)
  from.rotation.y = 0.6
  const framing = { focus: new THREE.Vector3(0, 0.55, 0), distance: 7.5, height: 1.5, shift: 0, fov: 42 }
  rig.showroom(from, 0.9, 10, framing)
  from.updateMatrixWorld()
  const relativePosition = from.worldToLocal(camera.position.clone())
  const relativeRotation = from.quaternion.clone().invert().multiply(camera.quaternion)
  const to = new THREE.Object3D()
  to.position.set(-180, 40, 220)
  to.rotation.y = -1.4
  rig.relocateShowroom(from, to)
  to.updateMatrixWorld()
  expect(to.worldToLocal(camera.position.clone()).distanceTo(relativePosition)).toBeLessThan(1e-8)
  expect(to.quaternion.clone().invert().multiply(camera.quaternion).angleTo(relativeRotation)).toBeLessThan(1e-6)
})
