import RAPIER from '@dimforge/rapier3d-compat'
import { initRapier } from '../../src/engine/PhysicsWorld'
import type { CorrectionState } from '../../src/multiplayer/CorrectionState'
import { DEFAULT_VEHICLE_CONFIG, type VehicleConfig } from '../../src/vehicles/VehicleConfig'
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics'
/** Real idle controller data for mocked transports; world is immediately freed. */
export async function idleCorrectionPhysics(config: VehicleConfig = DEFAULT_VEHICLE_CONFIG): Promise<Pick<CorrectionState, 'body' | 'controller'>> {
  await initRapier()
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  try {
    const car = new VehiclePhysics(config, world, { position: { x: 0, y: .3, z: 0 }, heading: 0 }, true)
    const p = car.body.translation(), q = car.body.rotation(), v = car.body.linvel(), a = car.body.angvel()
    return { body: { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
      velocity: { x: v.x, y: v.y, z: v.z }, angularVelocity: { x: a.x, y: a.y, z: a.z }, sleeping: car.body.isSleeping() },
      controller: car.controller.captureState() }
  } finally { world.free() }
}
