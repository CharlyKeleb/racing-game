import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { planEventSites, tracksideGain } from '../src/world/atmospherePlan'
import { TEST_CIRCUIT } from '../src/world/tracks'
import { TrackAtmosphere } from '../src/world/TrackAtmosphere'
import { makeTracksidePCM } from '../src/audio/TracksidePCM'
import { TracksideAmbience } from '../src/audio/TracksideAmbience'

function referenceLine() {
  const curve = new THREE.CatmullRomCurve3(TEST_CIRCUIT.controlPoints.map(([x,z]) => new THREE.Vector3(x,0,z)),true,'centripetal')
  return curve.getSpacedPoints(Math.round(curve.getLength()/4)).slice(0,-1)
}

describe('event-site safety', () => {
  it('keeps the complete reference footprints and barriers clear of every road segment', () => {
    const line = referenceLine(), sites = planEventSites(line, TEST_CIRCUIT.roadWidth)
    expect(sites).toHaveLength(3)
    expect(sites.filter(s => s.pit)).toHaveLength(1)
    for (const site of sites) {
      const sx = Math.cos(site.heading), sz = -Math.sin(site.heading), fx = Math.sin(site.heading), fz = Math.cos(site.heading)
      for (let x = -10.5; x <= 10.5; x += .5) for (let z = -5; z <= 5; z += .5) {
        const px = site.x + sx*x + fx*z, pz = site.z + sz*x + fz*z
        let distance = Infinity
        for (let i=0;i<line.length;i++) {
          const a=line[i], b=line[(i+1)%line.length], dx=b.x-a.x,dz=b.z-a.z
          const t=Math.max(0,Math.min(1,((px-a.x)*dx+(pz-a.z)*dz)/(dx*dx+dz*dz)))
          distance=Math.min(distance,Math.hypot(px-a.x-dx*t,pz-a.z-dz*t))
        }
        expect(distance).toBeGreaterThan(TEST_CIRCUIT.roadWidth/2+2.5)
      }
    }
  })
  it('refuses invalid lines and sites crowded by another route section', () => {
    expect(planEventSites([],14)).toEqual([])
    const parallel = Array.from({length:100},(_,i)=>({x:0,y:0,z:i*10}))
      .concat(Array.from({length:100},(_,i)=>({x:25,y:0,z:(99-i)*10})))
    // A second road 25m away occupies the first site's otherwise safe footprint.
    expect(planEventSites(parallel,14).some(s=>s.label==='START / FINISH')).toBe(false)
  })
})

describe('atmosphere presentation', () => {
  it('bounds geometry and draw calls, freezes on pause, and makes Low/reduced motion static', () => {
    const reduced={matches:false}
    vi.stubGlobal('matchMedia',()=>reduced)
    const atmosphere=new TrackAtmosphere(planEventSites(referenceLine(),14))
    const camera=new THREE.Vector3().copy(atmosphere.group.children[0].position)
    let meshes=0,triangles=0
    atmosphere.group.traverse(o=>{if(o instanceof THREE.Mesh){meshes++; triangles+=(o.geometry.index?.count ?? o.geometry.getAttribute('position').count)/3}})
    expect(meshes).toBeLessThanOrEqual(9)
    expect(triangles).toBeLessThan(2500)
    const flags=atmosphere.group.children[0].children[2] as THREE.Mesh
    const position=flags.geometry.getAttribute('position')
    atmosphere.setQuality('high');atmosphere.update(camera,.05,true)
    const animated=Array.from(position.array)
    atmosphere.update(camera,0,true)
    expect(Array.from(position.array)).toEqual(animated)
    atmosphere.update(camera,.05,true)
    expect(Array.from(position.array)).not.toEqual(animated)
    reduced.matches=true;atmosphere.update(camera,.05,true)
    const still=Array.from(position.array)
    atmosphere.update(camera,.05,true)
    expect(Array.from(position.array)).toEqual(still)
    reduced.matches=false;atmosphere.setQuality('low');atmosphere.update(camera,.05,true)
    expect(Array.from(position.array)).toEqual(still)
    atmosphere.update(camera,.05,false);expect(atmosphere.group.visible).toBe(false)
    atmosphere.update(new THREE.Vector3(10000,0,10000),.05,true)
    expect(atmosphere.group.children.every(o=>!o.visible)).toBe(true)
    atmosphere.dispose();vi.unstubAllGlobals()
  })
})

describe('trackside sound',()=>{
  it('generates finite quiet loops with silent seams and a distinct pit layer',()=>{
    const wind=makeTracksidePCM(false),pit=makeTracksidePCM(true)
    let peak=0,sum=0,diff=0
    for(let i=0;i<wind.length;i++){expect(Number.isFinite(wind[i])).toBe(true);peak=Math.max(peak,Math.abs(wind[i]));sum+=wind[i];diff+=Math.abs(wind[i]-pit[i])}
    expect(peak).toBeLessThan(.4);expect(peak).toBeGreaterThan(.02)
    expect(Math.abs(sum/wind.length)).toBeLessThan(.005)
    expect(Math.abs(wind[0])).toBe(0);expect(Math.abs(wind.at(-1)!)).toBe(0)
    expect(diff/wind.length).toBeGreaterThan(.01)
    expect(tracksideGain(150)).toBe(0);expect(tracksideGain(30)).toBeGreaterThan(tracksideGain(100))
  })
  it('pans from the camera, mutes off-track, and stops old sources on switch/dispose',()=>{
    const gains:ReturnType<typeof param>[]=[],pans:ReturnType<typeof param>[]=[],sources:{stop:ReturnType<typeof vi.fn>}[]=[]
    function param(){return {value:0,setTargetAtTime:vi.fn()}}
    const node=()=>{const n={connect:vi.fn(),disconnect:vi.fn()};n.connect.mockImplementation(()=>n);return n}
    const ctx={currentTime:0,createBuffer:(_n:number,len:number,rate:number)=>({duration:len/rate,copyToChannel:vi.fn()}),
      createGain:()=>{const gain=param();gains.push(gain);return {...node(),gain}},
      createStereoPanner:()=>{const pan=param();pans.push(pan);return {...node(),pan}},
      createBiquadFilter:()=>({...node(),frequency:param(),type:'lowpass'}),
      createBufferSource:()=>{const source={...node(),start:vi.fn(),stop:vi.fn(),buffer:null};sources.push(source);return source}}
    const ambience=new TracksideAmbience(ctx as unknown as AudioContext,node() as unknown as AudioNode)
    ambience.setAreas([{x:20,y:0,z:0,pit:false}])
    ambience.update(0,0,0,1,0,0,true,1)
    expect(pans[0].setTargetAtTime.mock.lastCall![0]).toBeGreaterThan(0)
    ambience.update(0,0,0,-1,0,0,true,1)
    expect(pans[0].setTargetAtTime.mock.lastCall![0]).toBeLessThan(0)
    ambience.update(0,0,0,1,0,0,false,1)
    expect(gains[0].setTargetAtTime.mock.lastCall![0]).toBe(0)
    ambience.setAreas([{x:0,y:0,z:0,pit:true}]);expect(sources[0].stop).toHaveBeenCalledOnce()
    ambience.dispose();expect(sources[1].stop).toHaveBeenCalledOnce()
  })
})
