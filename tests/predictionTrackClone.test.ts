import RAPIER from '@dimforge/rapier3d-compat'
import {beforeAll,expect,it} from 'vitest'
import {initRapier} from '../src/engine/PhysicsWorld'
import {StreamedTrack} from '../src/world/StreamedTrack'
beforeAll(()=>initRapier())
it('copies only track static collision and preserves the original world when the prediction copy is freed',()=>{
  const source=new RAPIER.World({x:0,y:-9.81,z:0})
  const body=source.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(10,0,20))
  source.createCollider(RAPIER.ColliderDesc.cuboid(5,.1,5).setFriction(.9).setTranslation(0,-.1,0),body)
  source.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0,2,0));source.step()
  const copy=StreamedTrack.prototype.createPredictionWorld.call({body,disposed:false} as never)
  const ray=new RAPIER.Ray({x:10,y:5,z:20},{x:0,y:-1,z:0})
  try {
    expect(copy.colliders.len()).toBe(1);expect(copy.bodies.len()).toBe(0)
    expect(copy.castRay(ray,10,true)?.timeOfImpact).toBeCloseTo(source.castRay(ray,10,true)!.timeOfImpact)
  } finally {copy.free()}
  expect(source.castRay(ray,10,true)).not.toBeNull();source.free()
})
