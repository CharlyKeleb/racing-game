import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { DriftChallenge, type DriftSample } from '../src/racing/DriftChallenge'
import { RaceManager } from '../src/racing/RaceManager'

// Rules use fixed simulation ticks, so pausing never drains the challenge clock.
describe('Drift Challenge', () => {
  it('links slides, caps the multiplier and banks once after a clean gap', () => {
    const run = new DriftChallenge()
    for (let i = 0; i < 1000; i++) run.update(1 / 60, 1, true)
    expect(run.multiplier).toBe(5)
    const points = Math.round(run.chain)
    run.update(0.7, 0, false)
    expect(run.total).toBe(0)
    run.update(1.8, 0, false)
    expect(run.total).toBe(points)
    expect(run.chain).toBe(0)
    run.bank()
    expect(run.total).toBe(points)
  })
  it('ignores invalid slides and forfeits a reset chain without losing banked points', () => {
    const run = new DriftChallenge()
    run.update(1, 500, false)
    expect(run.chain).toBe(0)
    run.update(1, 100, true)
    run.bank()
    run.update(1, 200, true)
    run.discard()
    expect(run.total).toBe(100)
    expect(run.chain).toBe(0)
    run.reset()
    expect(run.total).toBe(0)
  })
  it('has no time limit and finishes only after all course gates', () => {
    const gates = [0, 100].map((z, index) => ({index, position:new THREE.Vector3(0,0,z), tangent:new THREE.Vector3(0,0,1), radius:10}))
    const race = new RaceManager(gates, 1, {onStateChange:()=>{},onLap:()=>{}})
    const p = new THREE.Vector3(0,0,-10)
    race.start(1,2)
    race.update(2,p)
    expect(race.state).toBe('countdown')
    race.update(3,p)
    race.update(600,p)
    expect(race.state).toBe('racing')
    race.update(1,new THREE.Vector3(0,0,99))
    race.update(1,new THREE.Vector3(0,0,101))
    race.update(1,new THREE.Vector3(0,0,-1))
    race.update(1,new THREE.Vector3(0,0,1))
    expect(race.state).toBe('finished')
    expect(race.timer.running).toBe(false)
    race.start(1)
    expect(race.timer.totalMs).toBe(0)
  })
})

const slide:DriftSample={speed:80,angle:35,direction:1,distance:.5,grounded:true,paved:true,active:true,zone:false,impact:false}
describe('event scoring and risk',()=>{
  it('rewards clipping zones and clean transitions after committed travel',()=>{
    const plain=new DriftChallenge(),zone=new DriftChallenge()
    for(let i=0;i<60;i++){plain.sample(1/60,slide);zone.sample(1/60,{...slide,zone:true})}
    expect(zone.chain/plain.chain).toBeCloseTo(1.75)
    const score=plain.chain
    plain.sample(1/60,{...slide,direction:-1})
    expect(plain.transitions).toBe(1)
    expect(plain.chain-score).toBeGreaterThanOrEqual(250)
    // Steering chatter cannot farm transition bonuses.
    for(let i=0;i<10;i++)plain.sample(1/60,{...slide,direction:i%2?1:-1,distance:.01})
    expect(plain.transitions).toBe(1)
  })
  it('requires forward motion, ground contact and meaningful angle',()=>{
    for(const patch of [{speed:0},{speed:20},{distance:0},{grounded:false},{paved:false},{angle:5},{angle:115}]){
      const run=new DriftChallenge()
      run.sample(1/60,{...slide,...patch})
      expect(run.chain).toBe(0)
    }
  })
  it('busts unbanked points on impacts, spins and sustained offroad driving',()=>{
    for(const hazard of [{impact:true},{angle:110},{paved:false}]){
      const run=new DriftChallenge()
      run.sample(.5,slide);run.bank()
      const banked=run.total
      run.sample(.5,slide)
      for(let i=0;i<60;i++)run.sample(1/60,{...slide,...hazard})
      expect(run.chain).toBe(0)
      expect(run.busts).toBe(1)
      expect(run.total).toBe(banked)
    }
  })
  it('banks once and gives the same score at different fixed tick rates',()=>{
    const scores=[30,60,120].map(hz=>{
      const run=new DriftChallenge()
      for(let i=0;i<hz*10;i++)run.sample(1/hz,{...slide,distance:20/hz})
      run.bank();const total=run.total;run.bank();expect(run.total).toBe(total)
      return total
    })
    expect(Math.max(...scores)-Math.min(...scores)).toBeLessThan(15)
  })
})
