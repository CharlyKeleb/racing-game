import RAPIER from '@dimforge/rapier3d-compat'
import { expect, it } from 'vitest'
import { RaceSession, SERVER_TICK_MS } from '../server/src/RaceSession'
import { createRaceFactory, type SimulationBundle } from '../scripts/multiplayer/race-factory'
import { DEFAULT_VEHICLE_CONFIG as config } from '../src/vehicles/VehicleConfig'
import { PredictionWorld } from '../src/simulation/PredictionWorld'
import { PredictionReconciler } from '../src/multiplayer/PredictionReconciler'
import { decodeCorrectionJson } from '../src/multiplayer/CorrectionState'
import { emptyVehicleState } from '../src/multiplayer/SnapshotBuffer'
const vertices = [-1000,0,-1000,-1000,0,1000,1000,0,1000,1000,0,-1000], indices = [0,1,2,0,2,3]
const bundle: SimulationBundle = { format: 1, fingerprint: 'a'.repeat(64),
  cars: Object.fromEntries(['porsche911','diablo','koenigsegg','bmw','amg','charger'].map(id => [id, config])), track: {
    id: 'nurburgring', spawn: { position: { x: 0, y: 0, z: 0 }, heading: 0 },
    line: [{x:0,y:0,z:0},{x:0,y:0,z:1000},{x:1000,y:0,z:1000},{x:1000,y:0,z:0}],
    checkpoints: [{ index:0,position:[0,0,0],tangent:[0,0,1],radius:10 },{index:1,position:[0,0,900],tangent:[0,0,1],radius:10}],
    surface:null, meshes:[{vertices,indices,barrier:false}] } }
for (const delay of [1,3,6,9]) it('reconciles tick-scheduled ghost physics with ' + delay * 2 + ' ticks RTT and bounded jitter/omissions', async () => {
  const factory = createRaceFactory(bundle, { scheduledInputs: true })
  const race = new RaceSession([{id:'one',sessionId:'a',carId:'porsche911'},{id:'two',sessionId:'b',carId:'diablo'}],factory)
  let local: PredictionWorld | undefined
  try {
    await race.load(factory)
    for (const id of ['a','b']) race.acknowledge(id,{protocol:3,raceId:race.descriptor.id,fingerprint:factory.fingerprint,simulationVersion:1})
    for(let i=0;i<180;i++) race.advance(SERVER_TICK_MS)
    const world = new RAPIER.World({x:0,y:-9.81,z:0})
    world.createCollider(RAPIER.ColliderDesc.trimesh(Float32Array.from(vertices),Uint32Array.from(indices)).setFriction(.9))
    world.timestep=1/60;world.step()
    local=new PredictionWorld(world,config,()=>1)
    let wall=180,sequence=0,acceptedTick=-1,ack=-1
    const commands: {due:number;value:unknown}[]=[], corrections:{due:number;json:string}[]=[]
    const prediction=new PredictionReconciler(local,(tick,input)=>{
      const value={...input,version:1,tick,sequence:sequence++,raceId:race.descriptor.id}
      if(sequence%29!==0) commands.push({due:wall+delay+(sequence%3===0?1:0),value})
      return true
    },Math.min(24,Math.max(6,delay*2+6)))
    const positions=new Map<number,{x:number;y:number;z:number}>(),errors:number[]=[]
    const out=emptyVehicleState('one')
    for(wall=181;wall<=1080;wall++) {
      for(let i=commands.length-1;i>=0;i--) if(commands[i].due<=wall) {race.scheduledInput('a',commands[i].value,wall*SERVER_TICK_MS);commands.splice(i,1)}
      race.advance(SERVER_TICK_MS)
      const frame=race.snapshot()!, state=frame.vehicles[0], predicted=positions.get(race.tick)
      if(predicted) errors.push(Math.hypot(predicted.x-state.position.x,predicted.y-state.position.y,predicted.z-state.position.z))
      positions.delete(race.tick)
      if(wall%6===0 && wall%78!==0) { const json=race.correction('a');if(json)corrections.push({due:wall+delay+(wall%18===0?1:0),json}) }
      for(let i=corrections.length-1;i>=0;i--) if(corrections[i].due<=wall) {
        const corrected=decodeCorrectionJson(corrections[i].json,{raceId:race.descriptor.id,racerId:'one',carId:'porsche911',fingerprint:factory.fingerprint,
          simulationVersion:1,afterTick:acceptedTick,acknowledgedSequence:ack,maximumSentSequence:sequence-1,config})
        if(corrected){prediction.accept(corrected,wall*SERVER_TICK_MS);acceptedTick=corrected.tick;ack=corrected.acknowledgedSequence}
        corrections.splice(i,1)
      }
      prediction.advance({throttle:1,brake:wall%180>150?.6:0,steer:wall%300<150?.1:-.1,handbrake:false,nitro:false},wall*SERVER_TICK_MS)
      if(prediction.ready) {local.read(out);positions.set(prediction.predictedTick,{...out.position})}
    }
    errors.sort((a,b)=>a-b)
    expect(errors.length).toBeGreaterThan(700)
    expect(errors[Math.floor(errors.length*.95)]).toBeLessThan(.5)
    expect(Math.max(...errors)).toBeLessThan(1)
    expect(race.tick).toBe(1080);expect(race.phase).toBe('racing')
    expect(sequence).toBeGreaterThan(700);expect(ack).toBeGreaterThan(500)
  } finally { local?.dispose();race.close('done') }
})
