import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { startingGrid } from '../src/racing/StartingGrid'
import { RaceManager } from '../src/racing/RaceManager'
import { RaceIntroCamera, RACE_INTRO_SECONDS } from '../src/camera/RaceIntroCamera'
import { ChaseCamera } from '../src/camera/ChaseCamera'
import { RaceStandings, type RaceEntry } from '../src/racing/RaceStandings'

const line = [{x:0,y:0,z:0},{x:0,y:0,z:100},{x:100,y:0,z:100},{x:100,y:0,z:-100},{x:0,y:0,z:-100}]
const gates = [0,2,3].map((i,index)=>({index,position:new THREE.Vector3(line[i].x,0,line[i].z),tangent:new THREE.Vector3(0,0,1),radius:10}))
const point = new THREE.Vector3(0,0,-8)

describe('visible starting grid', () => {
  it('starts the player behind all opponents with separated, forward-facing slots', () => {
    const grid = startingGrid(line,point,4)
    for(let i=0;i<grid.length;i++) {
      expect(grid[i].heading).toBeCloseTo(0)
      expect(grid[i].z).toBeCloseTo(-8-i*6)
      for(let j=0;j<i;j++) expect(Math.hypot(grid[i].x-grid[j].x,grid[i].z-grid[j].z)).toBeGreaterThan(5)
    }
    const standings = new RaceStandings(line,gates)
    const entries: RaceEntry[] = grid.map((p,i)=>({id:i,name:String(i),player:i===3,lap:0,checkpoint:0,index:p.index,finishMs:null,x:p.x,z:p.z}))
    expect(standings.snapshot(entries).find(e=>e.player)?.position).toBe(4)
  })
  it('keeps the entire opponent field visible during the countdown', () => {
    const grid = startingGrid(line,point,4)
    const player = new THREE.Object3D()
    player.position.set(grid[3].x,0.6,grid[3].z)
    const camera = new THREE.PerspectiveCamera(58,16/9,0.1,2000)
    const chase = new ChaseCamera(camera)
    chase.update(player,0,1/60,0,undefined,1)
    camera.updateMatrixWorld()
    for(const slot of grid.slice(0,-1)) {
      const screen = new THREE.Vector3(slot.x,1.2,slot.z).project(camera)
      expect(Math.abs(screen.x)).toBeLessThan(0.95)
      expect(Math.abs(screen.y)).toBeLessThan(0.95)
      expect(screen.z).toBeLessThan(1)
    }
  })
  it('fits narrow roads and keeps a solo driver centered', () => {
    const edges = {left:new Float32Array(line.length).fill(2.5),right:new Float32Array(line.length).fill(2.5)}
    expect(startingGrid(line,point,4,edges).every(p=>Math.abs(p.x)<=1)).toBe(true)
    expect(startingGrid(line,point,1)[0].x).toBe(0)
  })
})

describe('fair intro timing', () => {
  it('locks the whole field and starts race timing only after intro plus countdown', () => {
    const races = Array.from({length:4},()=>new RaceManager(gates,1,{onStateChange:()=>{},onLap:()=>{}}))
    for(const race of races) race.start(1,RACE_INTRO_SECONDS)
    for(let i=0;i<288;i++) for(const race of races) race.update(1/60,point)
    for(const race of races) {
      expect(race.state).toBe('countdown')
      expect(race.countdown).toBe(3)
      expect(race.timer.totalMs).toBe(0)
      expect(race.controlsEnabled).toBe(false)
    }
    for(let i=0;i<181;i++) for(const race of races) race.update(1/60,point)
    expect(races.every(r=>r.state==='racing' && r.controlsEnabled)).toBe(true)
    expect(races.every(r=>r.timer.totalMs===races[0].timer.totalMs)).toBe(true)
  })
  it('skips once to a full countdown, and restarts with a fresh intro', () => {
    const race = new RaceManager(gates,1,{onStateChange:()=>{},onLap:()=>{}})
    race.start(1,RACE_INTRO_SECONDS)
    race.update(1,point)
    race.skipIntro(); race.skipIntro()
    expect(race.countdown).toBe(3)
    expect(race.timer.totalMs).toBe(0)
    race.start(1,RACE_INTRO_SECONDS)
    expect(race.introRemaining).toBe(RACE_INTRO_SECONDS)
    expect(race.state).toBe('intro')
  })
  it('ends the cinematic at the countdown camera without a jump', () => {
    const player = new THREE.Object3D(), pole = new THREE.Object3D()
    player.position.set(-2,0.6,-26); pole.position.set(2,0.6,-8)
    const camera = new THREE.PerspectiveCamera(58,16/9,0.1,2000)
    const intro = new RaceIntroCamera(camera)
    for(const progress of [0,0.2,0.4,0.7,1]) {
      intro.update(progress,player,pole)
      expect(camera.position.toArray().every(Number.isFinite)).toBe(true)
    }
    const position = camera.position.clone(), quaternion = camera.quaternion.clone()
    new ChaseCamera(camera).update(player,0,1/60,0,undefined,1)
    expect(camera.position.distanceTo(position)).toBeLessThan(0.0001)
    expect(camera.quaternion.angleTo(quaternion)).toBeLessThan(0.0001)
  })
})
