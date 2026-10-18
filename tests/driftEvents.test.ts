import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRIFT_EVENT, DRIFT_EVENTS, driftEvent, driftMedal, readDriftRecord, saveDriftRecord } from '../src/racing/driftEvents'
import { clippingZones } from '../src/effects/DriftZones'

afterEach(()=>vi.unstubAllGlobals())
describe('drift event progression',()=>{
  it('awards medals at each score target',()=>{
    expect(driftEvent('missing').id).toBe('flow')
    expect(Object.values(DRIFT_EVENTS).map(e=>e.laps)).toEqual([1,1,2])
    const event=DRIFT_EVENT
    expect(driftMedal(0,event.targets)).toBe('Unranked')
    event.targets.forEach((goal,i)=>expect(driftMedal(goal,event.targets)).toBe(['Bronze','Silver','Gold'][i]))
  })
  it('keeps personal bests separate by track and tolerates unavailable storage',()=>{
    const data=new Map<string,string>()
    vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>data.set(key,value)})
    saveDriftRecord('drift-park',{score:17000,chain:7000})
    expect(readDriftRecord('drift-park')).toEqual({score:17000,chain:7000})
    expect(readDriftRecord('singapore').score).toBe(0)
    expect(readDriftRecord('drift-park','sprint').score).toBe(0)
    vi.stubGlobal('localStorage',{getItem:()=>{throw Error('Blocked')},setItem:()=>{throw Error('Blocked')}})
    expect(readDriftRecord('drift-park').score).toBe(0)
    expect(()=>saveDriftRecord('drift-park',{score:1,chain:1})).not.toThrow()
  })
  it('places clipping targets on road points with room between them and away from the start',()=>{
    const line=Array.from({length:180},(_,i)=>({x:100*Math.cos(i*Math.PI/90),y:2,z:100*Math.sin(i*Math.PI/90)}))
    const zones=clippingZones(line)
    expect(zones).toHaveLength(3)
    zones.forEach((zone,i)=>{
      expect(line.some(p=>p.x===zone.x&&p.z===zone.z)).toBe(true)
      expect(Math.hypot(zone.x-line[0].x,zone.z-line[0].z)).toBeGreaterThanOrEqual(35)
      zones.slice(i+1).forEach(other=>expect(Math.hypot(zone.x-other.x,zone.z-other.z)).toBeGreaterThanOrEqual(55))
    })
  })
})

it('can finish the imported park by following the shipped centreline through every gate',async()=>{
  const {readFileSync}=await import('node:fs')
  const {RaceManager}=await import('../src/racing/RaceManager')
  const THREE=await import('three')
  const manifest=JSON.parse(readFileSync('public/models/tracks/drift-park/track.json','utf8'))
  const checkpoints=manifest.checkpoints.map((c:{index:number;position:[number,number,number];tangent:[number,number,number];radius:number})=>({...c,position:new THREE.Vector3(...c.position),tangent:new THREE.Vector3(...c.tangent)}))
  const race=new RaceManager(checkpoints,1,{onStateChange:()=>{},onLap:()=>{}})
  race.start(1)
  race.update(3,new THREE.Vector3(...manifest.spawn.position))
  for(const p of [...manifest.line,...manifest.line.slice(0,10)])race.update(.1,new THREE.Vector3(...p as [number,number,number]))
  expect(race.state).toBe('finished')
})
