import {afterEach,describe,expect,it,vi} from 'vitest'
import * as THREE from 'three'
import {AwarenessRoute,ProximityRadar,type AwarenessCar} from '../src/racing/ProximityRadar'
import {Game} from '../src/engine/Game'
import {gameStore} from '../src/stores/gameStore'
import {proximityStore} from '../src/stores/proximityStore'
import {AudioManager} from '../src/audio/AudioManager'
import {clearProximityLine} from '../src/engine/ProximityQuery'
import RAPIER from '@dimforge/rapier3d-compat'
const car=(patch:Partial<AwarenessCar>={}):AwarenessCar=>({id:0,x:0,y:.7,z:0,fx:0,fz:1,vx:0,vz:30,halfWidth:.95,halfLength:2.2,route:100,...patch})
const connected=()=>true,player=car()
function tick(radar:ProximityRadar,rivals:AwarenessCar[],seconds=.8,p=player,filter=connected){const cues:string[]=[];for(let t=0;t<seconds-.001;t+=.05){radar.update(p,rivals,1000,.05,filter);if(radar.cue)cues.push(radar.cue)}return cues}
const saved=gameStore.getState()
afterEach(()=>{gameStore.setState(saved);proximityStore.setState({radar:null,frame:0})})

describe('proximity radar',()=>{
  it('detects both passing sides, then waits for a stable clear and does not repeat',()=>{
    const radar=new ProximityRadar(),left=car({id:1,x:2.8}),right=car({id:2,x:-2.8})
    expect(tick(radar,[left])).toEqual(['left']);expect(radar.left).toBe(true);expect(radar.right).toBe(false)
    expect(tick(radar,[left],3)).toEqual([])
    expect(tick(radar,[left,right],1.5)).toEqual(['both'])
    tick(radar,[right],.25);expect(radar.left).toBe(true)
    expect(tick(radar,[right],1.5)).toContain('clear-left');expect(radar.left).toBe(false);expect(radar.right).toBe(true)
    expect(tick(radar,[],1.6)).toContain('clear');expect(radar.right).toBe(false)
    expect(tick(radar,[],2)).toEqual([])
  })
  it('keeps an overlap through small boundary jitter without cue chatter',()=>{
    const radar=new ProximityRadar(),rival=car({id:1,x:2.8,z:4.5})
    tick(radar,[rival]);expect(radar.left).toBe(true)
    const cues:string[]=[]
    for(let i=0;i<100;i++){rival.z=i%2?5.1:4.5;radar.update(player,[rival],1000,.05,connected);if(radar.cue)cues.push(radar.cue)}
    expect(radar.left).toBe(true);expect(cues).toEqual([])
    rival.z=7;tick(radar,[rival],.6);expect(radar.left).toBe(false)
  })
  it('marks a rapidly closing rear car but ignores receding traffic and distant racers',()=>{
    const radar=new ProximityRadar(),rival=car({id:1,z:-20,route:80,vz:40})
    tick(radar,[rival]);expect(radar.rear).toBe(true);expect(radar.contacts[0].approaching).toBe(true)
    rival.vz=20;tick(radar,[rival]);expect(radar.rear).toBe(false)
    rival.z=-40;tick(radar,[rival]);expect(radar.contacts.some(c=>c.active)).toBe(false)
  })
  it('rejects bridges, disconnected nearby route sections and a pit wall, but wraps the start line',()=>{
    const radar=new ProximityRadar()
    tick(radar,[car({id:1,x:3,y:4}),car({id:2,x:3,route:450}),car({id:3,x:4})],.8,player,()=>false)
    expect(radar.contacts.some(c=>c.active)).toBe(false)
    tick(radar,[car({id:1,x:3,y:4}),car({id:2,x:3,route:450})]);expect(radar.contacts.some(c=>c.active)).toBe(false)
    const nearStart=car({route:995}),afterStart=car({id:4,x:3,route:2})
    tick(radar,[afterStart],.8,nearStart);expect(radar.contacts[0].id).toBe(4);expect(radar.left).toBe(true)
  })
  it('uses the driver frame and actual velocity when reversing or spun, without marking an inline car as both sides',()=>{
    const radar=new ProximityRadar(),reverse=car({fx:0,fz:-1,vz:10})
    tick(radar,[car({id:1,x:-3,z:0})],.8,reverse);expect(radar.left).toBe(true)
    expect(radar.contacts[0].left).toBe(3)
    radar.reset();tick(radar,[car({id:1,x:0,z:2})]);expect(radar.left||radar.right).toBe(false)
    radar.reset();tick(radar,[car({id:1,x:0,z:0,fx:1,fz:0})]);expect(radar.left&&radar.right).toBe(true)
    radar.reset();tick(radar,[car({id:2,z:18,vz:-5,fx:0,fz:-1})],.8,reverse);expect(radar.rear).toBe(true)
  })
  it('clears active contacts, notice, delayed cue state and reuses its entire buffer with multiple opponents',()=>{
    const radar=new ProximityRadar(),buffer=radar.contacts,cells=buffer.slice(),rivals=[car({id:1,x:3}),car({id:2,x:-3}),car({id:3,x:0,z:-15,vz:40})]
    tick(radar,rivals);radar.reset()
    expect(radar.notice).toBeNull();expect(radar.cue).toBeNull();expect(radar.left||radar.right||radar.rear).toBe(false)
    expect(buffer.some(c=>c.active)).toBe(false)
    expect(tick(radar,[],3)).toEqual([])
    for(let i=0;i<200;i++)radar.update(player,rivals,1000,.05,connected)
    expect(radar.contacts).toBe(buffer);cells.forEach((cell,i)=>expect(radar.contacts[i]).toBe(cell))
  })
  it('projects progress locally on irregular spacing without jumping onto a parallel return road',()=>{
    const route=new AwarenessRoute([{x:0,y:0,z:0},{x:0,y:0,z:5},{x:0,y:0,z:100},{x:4,y:0,z:100},{x:4,y:0,z:5},{x:4,y:0,z:0}])
    expect(route.project(0,25,1)).toBeCloseTo(25)
    expect(route.project(4,25,4)).toBeGreaterThan(170)
  })
})

describe('game awareness wiring',()=>{
  it('filters a real static pit wall while allowing dynamic traffic on the same road',async()=>{
    await RAPIER.init()
    const world=new RAPIER.World({x:0,y:0,z:0}),ray=new RAPIER.Ray({x:0,y:0,z:0},{x:1,y:0,z:0}),a=car(),b=car({id:1,x:4})
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(2,.7,0))
    world.createCollider(RAPIER.ColliderDesc.cuboid(.1,1,3),body);world.step()
    expect(clearProximityLine(world,ray,a,b)).toBe(true)
    const wall=world.createCollider(RAPIER.ColliderDesc.cuboid(.1,1,3).setTranslation(2,.7,0));world.step()
    expect(clearProximityLine(world,ray,a,b)).toBe(false)
    world.removeCollider(wall,true);world.step();expect(clearProximityLine(world,ray,a,b)).toBe(true)
    world.free()
  })
  function game(){
    const radar=new ProximityRadar(),vehicle={model:{root:new THREE.Object3D()},config:{chassisCenter:[0,.65,0],chassisHalfExtents:[.95,.4,2.2]},motion:{velocity:new THREE.Vector3(0,0,30)},respawn:vi.fn()}
    const rival={...vehicle,model:{root:new THREE.Object3D()}};rival.model.root.position.x=3
    const route=new AwarenessRoute([{x:0,y:0,z:0},{x:0,y:0,z:100},{x:100,y:0,z:100},{x:100,y:0,z:0}])
    return Object.assign(Object.create(Game.prototype),{awareness:radar,awarenessFrame:0,awarenessRoute:route,awarenessPlayer:car(),awarenessCars:[car({id:1})],awarenessConnected:connected,vehicle,opponents:[{vehicle:rival,driver:{progress:{index:0}}}],progress:{index:0,reset:vi.fn(),update:vi.fn()},track:{spawn:{position:{x:0,y:0,z:0}}},camera:{snap:vi.fn()},race:{state:'racing'},audio:{playSpotter:vi.fn(),clearSpotter:vi.fn(),suspend:vi.fn(),resume:vi.fn()}})
  }
  it('keeps audio and visual preferences independent and silences/reset clears contact state',()=>{
    const g=game();gameStore.setState({phase:'racing',settings:{...saved.settings,spotterAudio:false,proximityRadar:true,spotterVisual:false}})
    for(let i=0;i<20;i++)g.updateAwareness(.05)
    expect(proximityStore.getState().radar?.left).toBe(true);expect(g.audio.playSpotter).not.toHaveBeenCalled()
    g.clearAwareness();gameStore.setState({settings:{...gameStore.getState().settings,spotterAudio:true,proximityRadar:false}})
    for(let i=0;i<20;i++)g.updateAwareness(.05)
    expect(g.audio.playSpotter).toHaveBeenCalledWith('left')
    g.resetCar();expect(proximityStore.getState().radar).toBeNull();expect(g.awareness.left).toBe(false);expect(g.audio.clearSpotter).toHaveBeenCalled()
    gameStore.setState({phase:'paused'});g.updateAwareness(.05);expect(proximityStore.getState().radar).toBeNull()
  })
})

describe('spotter sound lifecycle',()=>{
  it('pans flank warnings and cancels every scheduled tone on reset/pause',()=>{
    const voices:{stop:ReturnType<typeof vi.fn>;disconnect:ReturnType<typeof vi.fn>}[]=[],pans:{pan:{value:number}}[]=[]
    const node=()=>({connect:vi.fn((next:unknown)=>next),disconnect:vi.fn()})
    const ctx={state:'running',currentTime:0,
      createOscillator:()=>{const tone={...node(),type:'sine',frequency:{value:0},start:vi.fn(),stop:vi.fn(),onended:null};voices.push(tone);return tone},
      createGain:()=>({...node(),gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()}}),
      createStereoPanner:()=>{const pan={...node(),pan:{value:0}};pans.push(pan);return pan}}
    const audio=Object.assign(Object.create(AudioManager.prototype),{ctx,paused:false,spotterVoices:new Set(),fxBus:node()})
    audio.playSpotter('left');expect(pans.every(p=>p.pan.value<0)).toBe(true);expect(audio.spotterVoices.size).toBe(2)
    audio.clearSpotter();expect(audio.spotterVoices.size).toBe(0);expect(voices.every(v=>v.stop.mock.calls.length===2&&v.disconnect.mock.calls.length>0)).toBe(true)
    pans.length=0;audio.playSpotter('clear-right');expect(pans.every(p=>p.pan.value>0)).toBe(true)
    audio.clearSpotter();ctx.state='suspended';audio.playSpotter('both');expect(audio.spotterVoices.size).toBe(0)
  })
})
