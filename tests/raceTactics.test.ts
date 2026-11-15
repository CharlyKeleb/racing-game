import { describe, expect, it } from 'vitest'
import { Overtaking } from '../src/racing/Overtaking'
import { draftingStrength } from '../src/racing/Drafting'
import { AiDriver, type DriverResources, type TrafficCar } from '../src/racing/AiDriver'
import { DRIVER_PROFILES } from '../src/racing/AiProfiles'
import { Nitro } from '../src/vehicles/Nitro'
import { DEFAULT_VEHICLE_CONFIG } from '../src/vehicles/VehicleConfig'
import { RaceStandings, type RaceEntry } from '../src/racing/RaceStandings'

const pose = { x: 0, z: 0, heading: 0, speed: 25 }
const target: TrafficCar = { id: 2, x: 0, z: 25, heading: 0, speed: 18 }
const straight = Array.from({length: 100}, (_, i) => ({x:0, y:0, z:i*4}))
const config = { wheelbase: 2.7, maxSteerAngle: 0.55, steerFalloffSpeed: 30 }
const tank: DriverResources = { charge: 0.7, boosting: false, drifting: false }

describe('committed overtaking', () => {
  it('drafts, commits, and keeps its side despite target movement', () => {
    const tactics = new Overtaking()
    tactics.update(1/60, pose, [target], 1, 5, 1, 0, 0, 0, 0)
    expect(tactics.phase).toBe('draft')
    tactics.update(1, pose, [target], 1, 5, 1, 0, 0, 0, 0)
    expect(tactics.phase).toBe('pass')
    const side = tactics.lane
    tactics.update(1/60, pose, [{...target, x:0.9}], 1, 5, 1, 0, 0, 0, 0.5)
    expect(tactics.lane).toBe(side)
    expect(tactics.targetId).toBe(2)
  })
  it('abandons an occupied passing corridor without swerving into another lane', () => {
    const tactics = new Overtaking()
    tactics.update(1/60, pose, [target], 1, 5, 1, 0, 0, 0, 0.8)
    const side = tactics.lane
    tactics.update(1/60, pose, [target, {...target, id:3, x:side, z:8}], 1, 5, 1, 0, 0, 0, 0.8)
    expect(tactics.phase).toBe('yield')
    expect(tactics.lane).toBe(0)
  })
  it('leaves room for fast approaching cars and refuses narrow-road passes', () => {
    for (const traffic of [[target, {...target,id:3,x:3.5,z:-12,speed:40}], [target]]) {
      const tactics = new Overtaking()
      tactics.update(1/60, pose, traffic, 1, traffic.length === 1 ? 1 : 5, 1, 0, 0, 0, 0.8)
      expect(tactics.phase).toBe('yield')
    }
  })
})

describe('drafting and earned nitro', () => {
  it('requires alignment, moving traffic and a safe following distance', () => {
    expect(draftingStrength(pose,[target],1)).toBeGreaterThan(0)
    for (const car of [{...target,x:3}, {...target,z:3}, {...target,heading:Math.PI}, {...target,speed:0}, {...target,z:80}]) expect(draftingStrength(pose,[car],1)).toBe(0)
  })
  it('earns the same bounded tank charge without filling during a burn', () => {
    const a = new Nitro(DEFAULT_VEHICLE_CONFIG.nitro), b = new Nitro(DEFAULT_VEHICLE_CONFIG.nitro)
    const input = {slip:0,speed:25,grounded:true,airborne:false,wantsBoost:false,drafting:1}
    for(let i=0;i<120;i++){a.update(input,1/60);b.update(input,1/60)}
    expect(a.charge).toBeCloseTo(0.2)
    expect(a.charge).toBe(b.charge)
    const before = a.charge
    a.update({...input,wantsBoost:true},1/60)
    expect(a.charge).toBeLessThan(before)
    b.update({...input,speed:0,drafting:100},1)
    expect(b.charge).toBeCloseTo(0.2)
  })
})

it('uses earned nitro for a safe pass, but refuses boosts into traffic or a corner', () => {
  const driver = new AiDriver(straight,config,1,DRIVER_PROFILES[1])
  driver.update(1/60,pose,[target],1,0,5,tank)
  expect(driver.input.nitro).toBe(true)
  driver.update(1/60,pose,[{...target,z:6}],1,0,5,tank)
  expect(driver.input.nitro).toBe(false)
  expect(driver.input.brake).toBeGreaterThan(0)
  const curve = Array.from({length:160},(_,i)=>({x:30*Math.cos(i*Math.PI/80),y:0,z:30*Math.sin(i*Math.PI/80)}))
  const corner = new AiDriver(curve,config,1,DRIVER_PROFILES[1])
  corner.update(1/60,{...pose,x:30},[],1,0,5,tank)
  expect(corner.input.nitro).toBe(false)
})

it('difficulty changes competitive pace and braking; personalities have different strengths', () => {
  const legend = new AiDriver(straight,config,1,DRIVER_PROFILES[0],'legend')
  const mythic = new AiDriver(straight,config,1,DRIVER_PROFILES[0],'mythic')
  const impossible = new AiDriver(straight,config,1,DRIVER_PROFILES[0],'impossible')
  for (const d of [legend, mythic, impossible]) d.update(1/60,pose,[],1,0,5)
  expect(mythic.targetSpeed).toBeGreaterThan(legend.targetSpeed)
  expect(impossible.targetSpeed).toBeGreaterThan(mythic.targetSpeed)
  // Ahead of the player, no difficulty eases off.
  for (const [d, base] of [['legend', legend], ['impossible', impossible]] as const) {
    const lead = new AiDriver(straight,config,1,DRIVER_PROFILES[0],d)
    lead.update(1/60,pose,[],1,-300,5)
    expect(lead.targetSpeed / base.targetSpeed).toBeCloseTo(1, 5)
  }
  expect(DRIVER_PROFILES[0].corner).toBeGreaterThan(DRIVER_PROFILES[1].corner)
  expect(DRIVER_PROFILES[1].straight).toBeGreaterThan(DRIVER_PROFILES[0].straight)
  expect(DRIVER_PROFILES[2].style).toBe('drift')
})

it('shows actual metre gaps across sector and lap boundaries, and finish-time gaps', () => {
  const line = [{x:0,y:0,z:0},{x:0,y:0,z:100},{x:100,y:0,z:100},{x:100,y:0,z:0}]
  const standings = new RaceStandings(line,[{position:line[0]},{position:line[2]}])
  const player: RaceEntry = {id:0,name:'You',player:true,lap:1,checkpoint:0,index:0,finishMs:null,x:0,z:20}
  const rival = {...player,id:1,player:false,z:50}
  expect(standings.snapshot([player,rival])[1].gapMeters).toBeCloseTo(30)
  expect(standings.snapshot([{...player,lap:2},rival])[1].gapMeters).toBeCloseTo(370)
  expect(standings.snapshot([{...player,finishMs:2000},{...rival,finishMs:1200}])[1].gapMs).toBe(800)
})

it('holds the corner-exit opportunity until a grip driver can safely accelerate', async () => {
  const { readFile } = await import('node:fs/promises')
  const manifest = JSON.parse(await readFile('public/models/tracks/nurburgring/track.json','utf8')) as {line:[number,number,number][]}
  const line = manifest.line.map(([x,y,z])=>({x,y,z}))
  const driver = new AiDriver(line,config,1,DRIVER_PROFILES[0])
  let boosts = 0
  for(let i=0;i<line.length*2;i++) {
    const j=i%line.length, a=line[(j-1+line.length)%line.length], b=line[(j+1)%line.length]
    driver.update(0.1,{x:line[j].x,z:line[j].z,heading:Math.atan2(b.x-a.x,b.z-a.z),speed:Math.min(23,driver.speeds[j]*0.85)},[],1,0,5,tank)
    if(driver.input.nitro) boosts++
    expect(driver.input.handbrake).toBe(false)
  }
  expect(boosts).toBeGreaterThan(0)
})
