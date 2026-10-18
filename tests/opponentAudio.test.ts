import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { Game } from '../src/engine/Game'

// Exercise the camera-to-audio wiring without constructing WebGL or an AudioContext.
function audioGame(camera: THREE.PerspectiveCamera, position = new THREE.Vector3(10,0,-10)) {
  return Object.assign(Object.create(Game.prototype), {
    renderer: {camera},
    audio: {updateOpponent: vi.fn()},
    vehicle: {position:new THREE.Vector3(1000,0,1000), quaternion:new THREE.Quaternion()},
    opponents: [{vehicle:{position, controller:{drivetrain:{rpm:6500},throttlePedal:.8}}}],
    rivalRevs: [{rpm:2300,throttle:.3}],
  })
}

describe('camera-relative rival audio',()=>{
  it('uses cinematic distance and staging revs rather than the player car',()=>{
    const camera=new THREE.PerspectiveCamera()
    camera.position.set(0,12,-5)
    camera.lookAt(0,0,0)
    const game=audioGame(camera,new THREE.Vector3())
    game.updateOpponentAudio('intro',true)
    const [index,rpm,throttle,distance,lateral,active]=game.audio.updateOpponent.mock.lastCall
    expect({index,rpm,throttle,active}).toEqual({index:0,rpm:2300,throttle:.3,active:true})
    expect(distance).toBeCloseTo(13)
    expect(lateral).toBeCloseTo(0)
    game.vehicle.position.set(-500,0,400)
    game.vehicle.quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI)
    game.updateOpponentAudio('intro',true)
    expect(game.audio.updateOpponent.mock.lastCall).toEqual([index,rpm,throttle,distance,lateral,active])
  })
  it('flips stereo sides when the camera turns, before the next render',()=>{
    const camera=new THREE.PerspectiveCamera()
    const game=audioGame(camera)
    game.updateOpponentAudio('racing',false)
    // The existing stereo panner negates positive-left lateral offsets.
    expect(game.audio.updateOpponent.mock.lastCall[4]).toBeCloseTo(-10)
    expect(game.audio.updateOpponent.mock.lastCall[1]).toBe(6500)
    camera.rotation.y=Math.PI
    game.updateOpponentAudio('racing',false)
    expect(game.audio.updateOpponent.mock.lastCall[4]).toBeCloseTo(10)
    expect(game.audio.updateOpponent.mock.lastCall[3]).toBeCloseTo(Math.sqrt(200))
  })
  it('includes camera roll and parent world transforms',()=>{
    const parent=new THREE.Group(),camera=new THREE.PerspectiveCamera()
    parent.position.set(100,10,40)
    parent.add(camera)
    camera.position.set(0,2,0)
    camera.rotation.z=Math.PI/2
    const game=audioGame(camera,new THREE.Vector3(100,0,45))
    game.updateOpponentAudio('racing',false)
    expect(game.audio.updateOpponent.mock.lastCall[3]).toBeCloseTo(13)
    expect(game.audio.updateOpponent.mock.lastCall[4]).toBeCloseTo(12)
  })
  it('follows chase/cockpit translation and keeps paused rivals muted',()=>{
    const camera=new THREE.PerspectiveCamera()
    const game=audioGame(camera,new THREE.Vector3(0,0,-10))
    camera.position.z=10
    game.updateOpponentAudio('countdown',true)
    expect(game.audio.updateOpponent.mock.lastCall[3]).toBeCloseTo(20)
    camera.position.z=0
    game.updateOpponentAudio('racing',false)
    expect(game.audio.updateOpponent.mock.lastCall[3]).toBeCloseTo(10)
    game.updateOpponentAudio('paused',false)
    expect(game.audio.updateOpponent.mock.lastCall[5]).toBe(false)
  })
})
