import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { cockpitProfile, sanitizeCockpit } from '../src/vehicles/CockpitConfig'
import { CockpitRig } from '../src/vehicles/CockpitRig'
import type { CarModel } from '../src/vehicles/CarModel'
import { ChaseCamera } from '../src/camera/ChaseCamera'
import { gameStore } from '../src/stores/gameStore'

const saved = gameStore.getState()
afterEach(()=>{vi.unstubAllGlobals();gameStore.setState(saved)})
function canvas() {
  const text:unknown[][]=[]
  const context=new Proxy({fillText:(...args:unknown[])=>text.push(args)} as unknown as CanvasRenderingContext2D,{get:(obj,key)=>Reflect.get(obj,key)??(()=>{})})
  vi.stubGlobal('document',{createElement:()=>({width:512,height:128,getContext:()=>context})})
  return text
}

describe('cockpit seating and camera',()=>{
  it('sanitizes unsafe/old saves and keeps adjustments independent per car',()=>{
    expect(sanitizeCockpit({height:99,distance:-99,fov:100,yaw:Infinity,pitch:NaN},'koenigsegg')).toEqual({height:.025,distance:-.1,fov:12,yaw:0,pitch:0})
    expect(sanitizeCockpit(null,'bmw')).toEqual({height:0,distance:0,fov:0,yaw:0,pitch:0})
    let data=''
    vi.stubGlobal('localStorage',{setItem:(_key:string,value:string)=>{data=value}})
    gameStore.getState().updateSettings({car:'porsche911',cockpits:{porsche911:sanitizeCockpit({height:.02,fov:5},'porsche911')}})
    gameStore.getState().updateSettings({car:'bmw'})
    const settings=JSON.parse(data)
    expect(settings.cockpits.porsche911.height).toBe(.02)
    expect(settings.cockpits.bmw).toBeUndefined()
    gameStore.getState().updateSettings({cockpits:{...settings.cockpits,bmw:sanitizeCockpit({distance:.04},'bmw')}})
    expect(gameStore.getState().settings.cockpits.porsche911.fov).toBe(5)
    expect(gameStore.getState().settings.cockpits.bmw.distance).toBe(.04)
  })
  it('anchors each eye inside the moving body and settles to its own lens',()=>{
    for(const id of ['porsche911','koenigsegg','bmw']){
      const camera=new THREE.PerspectiveCamera(),rig=new ChaseCamera(camera),root=new THREE.Object3D(),body=new THREE.Object3D()
      root.position.set(20,1,-80);root.rotation.y=.7;body.rotation.set(.04,0,.02);root.add(body)
      rig.mode='cockpit';rig.cockpitCar=id;rig.cameraMotion=false
      const profile=cockpitProfile(id)
      for(let i=0;i<120;i++)rig.update(root,150,1/60,0,undefined,0,body)
      const expected=new THREE.Vector3(...profile.eye).applyMatrix4(body.matrixWorld)
      expect(camera.position.distanceTo(expected)).toBeLessThan(1e-7)
      expect(camera.near).toBe(.025);expect(camera.fov).toBeCloseTo(profile.fov,1)
      expect(new THREE.Vector3().set(0,1,0).applyQuaternion(camera.quaternion).dot(new THREE.Vector3(0,1,0).applyQuaternion(body.getWorldQuaternion(new THREE.Quaternion())))).toBeGreaterThan(.99)
    }
  })
  it('switches through a short fade instead of interpolating through the shell; reduced motion skips it',()=>{
    const camera=new THREE.PerspectiveCamera(),rig=new ChaseCamera(camera),car=new THREE.Object3D()
    rig.update(car,0,1/60)
    const chase=camera.position.clone()
    rig.mode='cockpit';rig.update(car,0,.03)
    expect(camera.position.distanceTo(chase)).toBeLessThan(1e-7);expect(rig.viewOpacity).toBeLessThan(1)
    rig.update(car,0,.06)
    expect(rig.viewOpacity).toBeLessThan(.01)
    rig.update(car,0,.1);expect(rig.viewOpacity).toBe(1)
    expect(camera.position.z).toBeLessThan(.1);expect(camera.position.z).toBeGreaterThan(-1)
    rig.cameraMotion=false;rig.mode='chase';rig.update(car,0,1/60)
    expect(rig.viewOpacity).toBe(1);expect(camera.position.z).toBeLessThan(-3)
  })
  it('bounds acceleration head travel and honours OS reduced motion',()=>{
    const car=new THREE.Object3D(),camera=new THREE.PerspectiveCamera(),rig=new ChaseCamera(camera)
    rig.mode='cockpit'
    const motion={accelLong:100,accelLat:0,velocity:new THREE.Vector3(),suspensionVelocity:0,roadRoughness:0,grounded:1}
    for(let i=0;i<120;i++)rig.update(car,0,1/60,0,motion)
    expect(camera.position.z).toBeCloseTo(cockpitProfile('porsche911').eye[2]-.012,4)
    vi.stubGlobal('matchMedia',()=>({matches:true}))
    const stillCamera=new THREE.PerspectiveCamera(),stillRig=new ChaseCamera(stillCamera)
    stillRig.update(car,0,1/60);stillRig.mode='cockpit'
    for(let i=0;i<120;i++)stillRig.update(car,0,1/60,0,motion)
    expect(stillRig.viewOpacity).toBe(1)
    expect(stillCamera.position.z).toBe(cockpitProfile('porsche911').eye[2])
  })
})

describe('cockpit visuals',()=>{
  it('updates speed, RPM and gear together and freezes while paused',()=>{
    const text=canvas(),root=new THREE.Group(),body=new THREE.Group();root.name='porsche911';root.add(body)
    const rig=new CockpitRig({root,body,wheels:{}} as CarModel)
    text.length=0;rig.update(.2,4200,127.8,4,7500,.06)
    expect(text.some(t=>t[0]==='128')).toBe(true);expect(text.some(t=>t[0]==='4200')).toBe(true);expect(text.some(t=>t[0]==='4')).toBe(true)
    const q=rig.steering.quaternion.clone(),count=text.length
    expect(q.z).toBeLessThan(0)
    rig.update(-.4,7000,200,5,7500,0)
    expect(rig.steering.quaternion.equals(q)).toBe(true);expect(text).toHaveLength(count)
    rig.update(-.4,7000,200,-1,7500,.06)
    expect(text.some(t=>t[0]==='R')).toBe(true);expect(rig.steering.quaternion.z).toBeGreaterThan(0)
    rig.dispose();expect(body.children).toHaveLength(0)
  })
  it('isolates stock steering in both real BMW/Koenigsegg LODs without changing cached geometry',async()=>{
    canvas();await MeshoptDecoder.ready
    const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
    for(const id of ['koenigsegg','bmw'])for(const tier of ['', '_low']){
      const doc=await io.read(`public/models/cars/${id}/${id}${tier}.glb`),root=new THREE.Group(),body=new THREE.Group()
      root.name=id;root.add(body)
      const original:{mesh:THREE.Mesh;geometry:THREE.BufferGeometry;array:ArrayLike<number>}[]=[]
      for(const node of doc.getRoot().listNodes()){
        if(!node.getMesh()||/wheel/i.test(node.getName()))continue
        for(const primitive of node.getMesh()!.listPrimitives()){
          const name=primitive.getMaterial()?.getName()??''
          if(!/cockpit|InCarbon|steeringwheel/i.test(name))continue
          const attribute=primitive.getAttribute('POSITION')!,positions=new Float32Array(attribute.getCount()*3)
          for(let i=0;i<attribute.getCount();i++)positions.set(attribute.getElement(i,[]),i*3)
          const geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(positions,3))
          const indices=primitive.getIndices();if(indices)geometry.setIndex(Array.from({length:indices.getCount()},(_,i)=>indices.getScalar(i)))
          geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()))
          const mesh=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({name}));body.add(mesh)
          original.push({mesh,geometry,array:geometry.getAttribute('position').array.slice()})
        }
      }
      const rig=new CockpitRig({root,body,wheels:{}} as CarModel)
      expect(rig.reusedWheel,`${id}${tier}`).toBe(true)
      expect(rig.steering.children.length).toBeGreaterThan(0)
      expect(new THREE.Box3().setFromObject(rig.steering).getSize(new THREE.Vector3()).x).toBeGreaterThan(id==='koenigsegg'?.38:.27)
      for(const source of original)expect(Array.from(source.geometry.getAttribute('position').array)).toEqual(Array.from(source.array))
      rig.dispose()
      for(const source of original){expect(source.mesh.geometry).toBe(source.geometry);source.geometry.dispose();(source.mesh.material as THREE.Material).dispose()}
    }
  },10000)
})
