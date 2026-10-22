import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { Game } from '../src/engine/Game'

// Exercise the camera-to-audio wiring without constructing WebGL or an AudioContext.
const still = () => ({ x: 0, y: 0, z: 0 })
const controller = (rpm: number, throttle: number) => ({ drivetrain: { rpm }, throttlePedal: throttle, wheels: [], forwardSpeed: 0, braking: 0, drift: { active: false } })
function audioGame(camera: THREE.PerspectiveCamera, position = new THREE.Vector3(10,0,-10)) {
  // The state object is reused between calls, so record a copy of each.
  const calls: { index: number; rpm: number; throttle: number; x: number; y: number; z: number; recession: number; active: boolean; distance: number }[] = []
  const updateOpponent = vi.fn((index: number, s: { rpm: number; throttle: number; x: number; y: number; z: number; recession: number; active: boolean }) => {
    calls.push({ index, rpm: s.rpm, throttle: s.throttle, x: s.x, y: s.y, z: s.z, recession: s.recession, active: s.active, distance: Math.hypot(s.x, s.y, s.z) })
  })
  const game = Object.assign(Object.create(Game.prototype), {
    renderer: {camera},
    audio: {updateOpponent},
    vehicle: {position:new THREE.Vector3(1000,0,1000), quaternion:new THREE.Quaternion(), body: { linvel: still }},
    opponents: [{vehicle:{position, body: { linvel: still }, controller: controller(6500, .8)}}],
    rivalRevs: [{rpm:2300,throttle:.3}],
    // Field initialisers don't run on Object.create: the reused state objects.
    rivalSound: {},
    rivalTyreSound: {},
  })
  return { game, calls, last: () => calls[calls.length - 1] }
}

describe('camera-relative rival audio',()=>{
  it('uses cinematic distance and staging revs rather than the player car',()=>{
    const camera=new THREE.PerspectiveCamera()
    camera.position.set(0,12,-5)
    camera.lookAt(0,0,0)
    const { game, last }=audioGame(camera,new THREE.Vector3())
    game.updateOpponentAudio('intro',true)
    const first = last()
    expect({index:first.index,rpm:first.rpm,throttle:first.throttle,active:first.active}).toEqual({index:0,rpm:2300,throttle:.3,active:true})
    expect(first.distance).toBeCloseTo(13)
    expect(first.x).toBeCloseTo(0)
    // The player's car moving doesn't move the listener.
    game.vehicle.position.set(-500,0,400)
    game.vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI)
    game.updateOpponentAudio('intro',true)
    expect(last()).toEqual(first)
  })
  it('flips stereo sides when the camera turns, before the next render',()=>{
    const camera=new THREE.PerspectiveCamera()
    const { game, last }=audioGame(camera)
    game.updateOpponentAudio('racing',false)
    // Camera at the origin looking down -Z; the rival at (10, 0, -10) is ahead and to the right.
    expect(last().x).toBeCloseTo(10)
    expect(last().z).toBeCloseTo(-10)
    expect(last().rpm).toBe(6500)
    camera.rotation.y=Math.PI
    game.updateOpponentAudio('racing',false)
    expect(last().x).toBeCloseTo(-10)
    expect(last().z).toBeCloseTo(10)
    expect(last().distance).toBeCloseTo(Math.sqrt(200))
  })
  it('includes camera roll and parent world transforms',()=>{
    const parent=new THREE.Group(),camera=new THREE.PerspectiveCamera()
    parent.position.set(100,10,40)
    parent.add(camera)
    camera.position.set(0,2,0)
    camera.rotation.z=Math.PI/2
    const { game, last }=audioGame(camera,new THREE.Vector3(100,0,45))
    game.updateOpponentAudio('racing',false)
    expect(last().distance).toBeCloseTo(13)
    // Rolled 90°: the rival 12 m below the camera is to its right.
    expect(last().x).toBeCloseTo(-12)
    expect(last().y).toBeCloseTo(0)
  })
  it('follows chase/cockpit translation and keeps paused rivals muted',()=>{
    const camera=new THREE.PerspectiveCamera()
    const { game, last }=audioGame(camera,new THREE.Vector3(0,0,-10))
    camera.position.z=10
    game.updateOpponentAudio('countdown',true)
    expect(last().distance).toBeCloseTo(20)
    camera.position.z=0
    game.updateOpponentAudio('racing',false)
    expect(last().distance).toBeCloseTo(10)
    game.updateOpponentAudio('paused',false)
    expect(last().active).toBe(false)
  })
  it('closing on a rival lowers its recession speed (doppler up)',()=>{
    const camera=new THREE.PerspectiveCamera()
    const { game, last }=audioGame(camera,new THREE.Vector3(0,0,-30))
    // Player (and camera) driving at 40 m/s toward a rival that's doing 20.
    game.vehicle.body.linvel = () => ({ x: 0, y: 0, z: -40 })
    game.opponents[0].vehicle.body.linvel = () => ({ x: 0, y: 0, z: -20 })
    game.updateOpponentAudio('racing',false)
    expect(last().recession).toBeCloseTo(-20)
  })
})
