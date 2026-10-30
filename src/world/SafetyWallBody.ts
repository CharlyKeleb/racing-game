import RAPIER from '@dimforge/rapier3d-compat'
import { floorHeightIn, headroomIn } from '../engine/PhysicsWorld'
import { planSafetyWalls, type SafetyWallMesh, type WallPoint } from './SafetyWalls'

const _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })

/**
 * The track's SafetyWalls, planned against the track colliders in `world` (they only answer ray
 * queries after a step). Offline, the race server and online prediction all plan them this way,
 * so every simulation of a track has the same walls.
 */
export function planTrackSafetyWalls(world: RAPIER.World, line: readonly WallPoint[], isBarrier: (collider: RAPIER.Collider) => boolean): SafetyWallMesh {
  return planSafetyWalls(line, {
    floor: (x, y, z) => floorHeightIn(world, x, y, z),
    headroom: (x, y, z, max) => headroomIn(world, x, y, z, max),
    barrier: (x, y, z, dx, dz, max) => {
      _ray.origin = { x, y, z }
      _ray.dir = { x: dx, y: 0, z: dz }
      const hit = world.castRay(_ray, max, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, undefined, isBarrier)
      return hit ? hit.timeOfImpact : null
    },
  })
}

/** Planned walls as one fixed trimesh body in `world`, or null when there are none. */
export function addSafetyWallMesh(world: RAPIER.World, walls: SafetyWallMesh): RAPIER.RigidBody | null {
  if (walls.segments === 0) return null
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.trimesh(walls.vertices, walls.indices).setFriction(0.2).setRestitution(0.1), body)
  return body
}

/** planTrackSafetyWalls, then addSafetyWallMesh. */
export function addSafetyWalls(world: RAPIER.World, line: readonly WallPoint[], isBarrier: (collider: RAPIER.Collider) => boolean): RAPIER.RigidBody | null {
  return addSafetyWallMesh(world, planTrackSafetyWalls(world, line, isBarrier))
}
