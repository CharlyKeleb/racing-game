import RAPIER from '@dimforge/rapier3d-compat'
import type {AwarenessCar} from '../racing/ProximityRadar'

/** Static separation at body height: pit walls block awareness, moving cars do not. */
export function clearProximityLine(world:RAPIER.World,ray:RAPIER.Ray,a:AwarenessCar,b:AwarenessCar):boolean {
  const x=b.x-a.x,y=b.y-a.y,z=b.z-a.z,distance=Math.hypot(x,y,z)
  if(distance<.2)return true
  ray.origin.x=a.x;ray.origin.y=a.y;ray.origin.z=a.z
  ray.dir.x=x/distance;ray.dir.y=y/distance;ray.dir.z=z/distance
  const hit=world.castRay(ray,distance,true,RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
  return !hit||hit.timeOfImpact>=distance-.25
}
