import {afterEach,describe,expect,it,vi} from 'vitest'
import * as THREE from 'three'
import {InputManager} from '../src/input/InputManager'
import {ChaseCamera} from '../src/camera/ChaseCamera'

afterEach(()=>vi.unstubAllGlobals())
function inputs(){
  const listeners=new Map<string,(event:{code?:string;repeat?:boolean;preventDefault?:()=>void})=>void>()
  let pads:(Gamepad|null)[]=[]
  vi.stubGlobal('window',{addEventListener:(name:string,fn:(event:never)=>void)=>listeners.set(name,fn),removeEventListener:vi.fn()})
  vi.stubGlobal('navigator',{getGamepads:()=>pads})
  const input=new InputManager()
  return {input,key:(name:'keydown'|'keyup',code:string)=>listeners.get(name)!({code,repeat:false,preventDefault:()=>{}}),blur:()=>listeners.get('blur')!({}),pad:(pressed:boolean,connected=true)=>{pads=connected?[{connected:true,axes:[.4],buttons:Array.from({length:16},(_,i)=>({pressed:i===11&&pressed,value:i===7?1:i===11&&pressed?1:0}))} as Gamepad]:[]}}
}

describe('held rear-view input',()=>{
  it('holds B independently of driving and releases on keyup and focus loss',()=>{
    const {input,key,blur}=inputs()
    key('keydown','KeyW');key('keydown','KeyB');input.poll()
    expect(input.state.lookBack).toBe(true);expect(input.state.throttle).toBe(1);expect(input.consume('camera')).toBe(false)
    key('keyup','KeyB');input.poll();expect(input.state.lookBack).toBe(false);expect(input.state.throttle).toBe(1)
    key('keydown','KeyB');input.poll();blur();expect(input.state.lookBack).toBe(false);input.poll();expect(input.state.lookBack).toBe(false)
    input.dispose()
  })
  it('merges R3 and touch holds, clears disconnect, and releasing one source does not cancel another',()=>{
    const {input,pad}=inputs()
    pad(true);input.poll();expect(input.state.lookBack).toBe(true);expect(input.state.steer).toBe(.4);expect(input.state.throttle).toBe(1)
    input.setTouch({lookBack:true});pad(false);input.poll();expect(input.state.lookBack).toBe(true)
    input.setTouch({lookBack:false});input.poll();expect(input.state.lookBack).toBe(false)
    pad(true);input.poll();pad(false,false);input.poll();expect(input.state.lookBack).toBe(false)
    input.dispose()
  })
})

describe('temporary rear camera',()=>{
  for(const mode of ['chase','cockpit'] as const)it(`restores the moving ${mode} view on release without changing mode or camera history`,()=>{
    const target=new THREE.Object3D(),body=new THREE.Object3D();target.add(body)
    const normal=new THREE.PerspectiveCamera(),rear=new THREE.PerspectiveCamera(),baseline=new ChaseCamera(normal),camera=new ChaseCamera(rear)
    baseline.mode=camera.mode=mode;baseline.cameraMotion=camera.cameraMotion=false
    for(let i=0;i<80;i++){target.position.z+=.3;target.rotation.y+=.002;baseline.update(target,100,1/60,0,undefined,0,body);camera.update(target,100,1/60,0,undefined,0,body)}
    camera.lookBack=true
    for(let i=0;i<40;i++){target.position.z+=.3;target.rotation.y+=.002;baseline.update(target,100,1/60,0,undefined,0,body);camera.update(target,100,1/60,0,undefined,0,body)}
    const forward=new THREE.Vector3(0,0,1).applyQuaternion(target.quaternion),view=new THREE.Vector3();rear.getWorldDirection(view)
    expect(view.dot(forward)).toBeLessThan(-.99);expect(rear.position.clone().sub(target.position).dot(forward)).toBeCloseTo(5)
    expect(camera.mode).toBe(mode);expect(camera.viewOpacity).toBe(1)
    camera.lookBack=false;baseline.update(target,100,1/60,0,undefined,0,body);camera.update(target,100,1/60,0,undefined,0,body)
    expect(rear.position.distanceTo(normal.position)).toBeLessThan(1e-7);expect(rear.quaternion.angleTo(normal.quaternion)).toBeLessThan(1e-7)
    expect(rear.fov).toBeCloseTo(normal.fov,6);expect(rear.near).toBe(mode==='cockpit'?.025:.1)
  })
  it('allows switching the underlying mode while held and snap clears the override',()=>{
    const lens=new THREE.PerspectiveCamera(),camera=new ChaseCamera(lens),car=new THREE.Object3D()
    camera.update(car,0,.02);camera.lookBack=true;camera.mode='cockpit';camera.update(car,0,.02)
    expect(camera.viewOpacity).toBe(1)
    camera.lookBack=false;camera.update(car,0,.02);expect(lens.position.z).toBeLessThan(0);expect(lens.near).toBe(.025);expect(camera.viewOpacity).toBe(1)
    camera.lookBack=true;camera.snap();expect(camera.lookBack).toBe(false)
  })
})
