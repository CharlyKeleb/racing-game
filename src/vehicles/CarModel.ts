import type { CockpitRig } from './CockpitRig'
import * as THREE from 'three'
import type { VehicleConfig, WheelId } from './VehicleConfig'

/**
 * Runtime view of a car's visual hierarchy. Any GLB that follows the naming
 * contract in docs/ASSET_PIPELINE.md (Chassis, Wheel_FL/FR/RL/RR, ...) is
 * normalised into this shape, so every car uses the same Vehicle code.
 */
export interface CarModel {
  root: THREE.Group
  /** Everything but the wheels: leaned for visual weight transfer while the wheels stay planted. */
  body: THREE.Object3D
  wheels: Record<WheelId, WheelRig>
  cockpit?: CockpitRig
}

/** pivot (position + steer yaw) → spinner (roll around X) → original wheel mesh */
export interface WheelRig {
  pivot: THREE.Group
  spinner: THREE.Group
}

const WHEEL_IDS: WheelId[] = ['FL', 'FR', 'RL', 'RR']

function findWheel(root: THREE.Object3D, id: WheelId): THREE.Object3D | undefined {
  const exact = root.getObjectByName(`Wheel_${id}`)
  if (exact) return exact
  // Tolerate exporter suffixes like "Wheel_FL.001" or "wheel_fl_mesh".
  const pattern = new RegExp(`wheel[_\\s-]?${id}`, 'i')
  let found: THREE.Object3D | undefined
  root.traverse((o) => {
    if (!found && pattern.test(o.name)) found = o
  })
  return found
}

export function rigCarModel(scene: THREE.Group, config: VehicleConfig): CarModel {
  const root = new THREE.Group()
  root.name = config.id
  root.add(scene)
  root.updateMatrixWorld(true)

  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      o.receiveShadow = true
    }
  })

  const wheels = {} as Record<WheelId, WheelRig>
  for (const id of WHEEL_IDS) {
    const pivot = new THREE.Group()
    pivot.name = `WheelPivot_${id}`
    const spinner = new THREE.Group()
    pivot.add(spinner)
    root.add(pivot)

    const node = findWheel(scene, id)
    if (node) {
      // Re-parent under the spinner, keeping orientation/scale but moving the
      // origin (which the pipeline guarantees is the axle center) to 0.
      root.attach(node)
      node.position.set(0, 0, 0)
      const fit = new THREE.Group()
      fit.name = `WheelFit_${id}`
      spinner.add(fit)
      fit.add(node)
      root.updateMatrixWorld(true)
      // Measure after retaining exporter rotation/scale. Fit in axle space so
      // diameter and tread width agree with the suspension/tyre configuration.
      // Only the wrapper changes: cached mesh geometry remains shared and intact.
      const bounds = new THREE.Box3().setFromObject(node, true)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      const wheel = config.wheels.find((wheel) => wheel.id === id)
      if (wheel && size.x > .001 && size.y > .001 && size.z > .001) {
        fit.scale.set(wheel.width / size.x, wheel.radius * 2 / size.y, wheel.radius * 2 / size.z)
        fit.position.copy(center).multiply(fit.scale).negate()
      }
    } else {
      console.warn(`[CarModel] ${config.id}: missing Wheel_${id}; wheel will be invisible`)
    }
    wheels[id] = { pivot, spinner }
  }
  return { root, body: scene, wheels }
}

/** Stand-in car used until the McLaren GLB exists in public/models/cars/mclaren/. */
export function buildPlaceholderCar(config: VehicleConfig): THREE.Group {
  const scene = new THREE.Group()
  const paint = new THREE.MeshPhysicalMaterial({
    name: 'paint', // so CarLivery repaints the placeholder too
    color: 0xff6a00, // papaya
    metalness: 0.6,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  })
  const dark = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 })
  const glass = new THREE.MeshPhysicalMaterial({ name: 'glass', color: 0x0a0f14, metalness: 0.2, roughness: 0.05, transmission: 0.2 })

  const [hx, hy, hz] = config.chassisHalfExtents
  const [cx, cy, cz] = config.chassisCenter

  const chassis = new THREE.Group()
  chassis.name = 'Chassis'
  const body = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 1.2, hz * 2), paint)
  body.position.set(cx, cy - hy * 0.2, cz)
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(hx * 1.5, hy * 1.0, hz * 0.9), glass)
  cabin.name = 'Glass'
  cabin.position.set(cx, cy + hy * 0.9, cz - hz * 0.05)
  const wing = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 0.05, 0.35), dark)
  wing.position.set(cx, cy + hy * 1.1, cz - hz * 0.92)
  chassis.add(body, cabin, wing)
  scene.add(chassis)

  const tire = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 })
  const rim = new THREE.MeshStandardMaterial({ name: 'rim', color: 0xbfc5cc, metalness: 1, roughness: 0.25 })
  for (const w of config.wheels) {
    const wheel = new THREE.Group()
    wheel.name = `Wheel_${w.id}`
    const tireMesh = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, w.width, 28), tire)
    tireMesh.rotation.z = Math.PI / 2
    const rimMesh = new THREE.Mesh(new THREE.CylinderGeometry(w.radius * 0.65, w.radius * 0.65, w.width + 0.01, 10), rim)
    rimMesh.rotation.z = Math.PI / 2
    wheel.add(tireMesh, rimMesh)
    wheel.position.set(w.position[0], w.position[1] - config.suspension.restLength, w.position[2])
    scene.add(wheel)
  }
  return scene
}
