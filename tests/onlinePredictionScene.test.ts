import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { initRapier } from '../src/engine/PhysicsWorld'
import { PredictionWorld } from '../src/simulation/PredictionWorld'
import { OnlineRaceScene } from '../src/multiplayer/OnlineRaceScene'
import { lobbyStore } from '../src/multiplayer/lobbyStore'
import { onlineRaceStore } from '../src/multiplayer/onlineRaceStore'
import { buildPlaceholderCar } from '../src/vehicles/CarModel'
import { DEFAULT_VEHICLE_CONFIG as config } from '../src/vehicles/VehicleConfig'
import { emptyVehicleState } from '../src/multiplayer/SnapshotBuffer'
import { VehiclePhysics } from '../src/vehicles/VehiclePhysics'
import type { CorrectionState } from '../src/multiplayer/CorrectionState'
const transport = vi.hoisted(() => ({ open: vi.fn(), send: vi.fn(() => 0), mailbox: vi.fn() }))
vi.mock('../src/multiplayer/LobbyClient', async () => ({ lobbyStore: (await import('../src/multiplayer/lobbyStore')).lobbyStore,
  openCorrectionStream: transport.open, sendScheduledRaceInput: transport.send, restoreMailboxControls: transport.mailbox }))
beforeAll(() => initRapier())
afterEach(() => { vi.restoreAllMocks();vi.unstubAllEnvs();lobbyStore.setState(lobbyStore.getInitialState(),true);onlineRaceStore.setState(onlineRaceStore.getInitialState(),true) })
it('wires opt-in own-car physics while remote poses remain authoritative, then releases input and frees its world', async () => {
  vi.stubEnv('VITE_ONLINE_PREDICTION','1')
  const now = vi.spyOn(performance,'now').mockReturnValue(0), stop=vi.fn()
  transport.open.mockReset();transport.open.mockReturnValue(stop);transport.send.mockClear();transport.mailbox.mockClear()
  const race={id:'race',protocol:3 as const,fingerprint:'a'.repeat(64),simulationVersion:1,tickRate:60 as const,snapshotRate:20 as const,countdownTicks:180,correctionVersion:1 as const,scheduledInputVersion:1 as const}
  const racers=[{id:'one',sessionId:'a',carId:'porsche911' as const},{id:'two',sessionId:'b',carId:'porsche911' as const}]
  const lobby={race,racers,phase:'racing',track:'nurburgring'}
  lobbyStore.setState({status:'connected',snapshot:lobby as never,sessionId:'a',connectionLatency:{rttMs:30,variationMs:0,samples:2}})
  const track=new THREE.Group(),environment=new THREE.Group(),offline=new THREE.Group(),root=new THREE.Scene()
  root.add(track,environment,offline)
  let owned!:RAPIER.World,free!:ReturnType<typeof vi.spyOn>
  const context={renderer:{scene:root,camera:new THREE.PerspectiveCamera(),render:vi.fn(),setHaze:vi.fn(),setMotionBlur:vi.fn(),setBoostBlur:vi.fn()},
    assets:{loadJson:vi.fn(async(url:string)=>url.includes('manifest')?{protocol:3,simulationVersion:1,fingerprint:race.fingerprint,track:'nurburgring',cars:['porsche911']}:config),loadModel:vi.fn(async()=>buildPlaceholderCar(config))},
    track:{id:'nurburgring',group:track,update:vi.fn(),surfaceAt:()=>1,createPredictionWorld:()=>{owned=new RAPIER.World({x:0,y:-9.81,z:0});owned.createCollider(RAPIER.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0));owned.step();free=vi.spyOn(owned,'free');return owned}},
    environment:{group:environment,follow:vi.fn(),carEnvironment:{map:null,intensity:1}},settings:{quality:'low',cameraMotion:false,fovEffects:false},
    audio:{setCarAudio:vi.fn(),setScene:vi.fn(),setMenuEngine:vi.fn(),resume:vi.fn(),update:vi.fn(),setRaceMusicActive:vi.fn()}}
  const scene=await OnlineRaceScene.load(context as never,lobby as never,'one')
  try {
    scene.push({raceId:race.id,tick:181,countdownTicks:0,phase:'racing',vehicles:[{...emptyVehicleState('one'),position:{x:20,y:.3,z:20},acknowledgedSequence:-1},
      {...emptyVehicleState('two'),position:{x:25,y:.3,z:30},acknowledgedSequence:-1}]},0)
    scene.render(0,1/60,false)
    const drive={throttle:1,brake:0,steer:0,handbrake:false,nitro:false}
    expect(scene.fixedUpdate(drive,0)).toBe(true);expect(transport.open).toHaveBeenCalledTimes(1)
    const authoritative=new RAPIER.World({x:0,y:-9.81,z:0})
    authoritative.createCollider(RAPIER.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0))
    const car=new VehiclePhysics(config,authoritative,{position:{x:20,y:.3,z:20},heading:0},true)
    for(let tick=0;tick<180;tick++){car.fixedUpdate({throttle:0,brake:0,steer:0,handbrake:true,nitro:false},1/60);authoritative.step()}
    const body=car.body, physics={controller:car.controller.captureState(),body:{position:{...body.translation()},rotation:{...body.rotation()},velocity:{...body.linvel()},angularVelocity:{...body.angvel()},sleeping:body.isSleeping()}}
    authoritative.free()
    const correction:CorrectionState={...physics,version:1,raceProtocol:3,raceId:race.id,racerId:'one',carId:'porsche911',fingerprint:race.fingerprint,simulationVersion:1,tick:181,acknowledgedSequence:-1,
      inputApplication:{mode:'neutral',firstTick:null,lastTick:null},body:physics.body}
    const coastWorld=new RAPIER.World({x:0,y:-9.81,z:0})
    coastWorld.createCollider(RAPIER.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0));coastWorld.step()
    const coast=new PredictionWorld(coastWorld,config,()=>1),coastState=emptyVehicleState('one')
    try {
      coast.restore(correction)
      for(let i=0;i<7;i++)coast.step({throttle:0,brake:0,steer:0,handbrake:false,nitro:false})
      coast.read(coastState)
    } finally {coast.dispose()}
    transport.open.mock.calls[0][3](correction)
    now.mockReturnValue(17);expect(scene.fixedUpdate(drive,17)).toBe(true)
    expect(transport.send).toHaveBeenCalledWith(188,drive)
    scene.render(17,1/60,false,1)
    const cars:THREE.Object3D[]=[];root.traverse(o=>{if(o.name===config.id)cars.push(o)})
    expect(cars[0].position.z).toBeGreaterThan(coastState.position.z);expect(cars[0].position.z).not.toBe(20);expect(cars[1].position.z).toBe(30)
    onlineRaceStore.setState({menuOpen:true})
    expect(scene.fixedUpdate(drive,34)).toBe(false);expect(stop).toHaveBeenCalledTimes(1);expect(transport.mailbox).toHaveBeenCalled()
    onlineRaceStore.setState({menuOpen:false})
    lobbyStore.setState({status:'reconnecting',connectionLatency:null})
    expect(scene.fixedUpdate(drive,35)).toBe(false)
    expect(scene.debugPrediction()).toMatchObject({ready:false,disabled:false,streamOpen:false})
    lobbyStore.setState({status:'connected',connectionEpoch:1})
    expect(scene.fixedUpdate(drive,36)).toBe(false) // fresh authentication alone does not supply an RTT sample
    expect(transport.open).toHaveBeenCalledTimes(1)
    lobbyStore.setState({connectionLatency:{rttMs:30,variationMs:0,samples:1}})
    expect(scene.fixedUpdate(drive,37)).toBe(true);expect(transport.open).toHaveBeenCalledTimes(2)
    now.mockReturnValue(38);transport.open.mock.calls[1][3]({...correction,tick:187,acknowledgedSequence:0})
    expect(scene.fixedUpdate(drive,38)).toBe(true)
    expect(scene.debugPrediction()).toMatchObject({ready:true,disabled:false,streamOpen:true})
    lobbyStore.setState({connectionLatency:{rttMs:500,variationMs:0,samples:1}})
    expect(scene.fixedUpdate(drive,39)).toBe(false)
    expect(scene.debugPrediction()).toMatchObject({ready:false,disabled:true,streamOpen:false})
  } finally {scene.dispose()}
  expect(free).toHaveBeenCalledTimes(1);expect(offline.visible).toBe(true)
})
