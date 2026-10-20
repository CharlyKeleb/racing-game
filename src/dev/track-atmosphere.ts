import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { Renderer } from '../engine/Renderer'
import { backend } from '../engine/backend'
import { Track } from '../world/Track'
import { TEST_CIRCUIT } from '../world/tracks'
import { TracksideAmbience } from '../audio/TracksideAmbience'
import type { QualityPreset } from '../stores/gameStore'

const renderer = new Renderer(document.querySelector('#view')!, new URLSearchParams(location.search).get('renderer') === 'webgpu' ? 'webgpu' : 'webgl')
await renderer.init(); renderer.applyQuality('low', false)
await RAPIER.init()
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
const track = new Track(TEST_CIRCUIT, world)
renderer.scene.add(track.group)
renderer.scene.background = new THREE.Color('#b2c9d6'); renderer.scene.fog = new THREE.Fog('#b2c9d6', 180, 600)
renderer.scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x667456, 2.6))
const sun = new THREE.DirectionalLight(0xffebcd, 2.3); sun.position.set(60, 100, -70); renderer.scene.add(sun)
let area = 0, quality: QualityPreset = 'high', paused = false, motion = true, visible = true
let ambience: TracksideAmbience | null = null, ctx: AudioContext | null = null
function frameArea() {
  const a = track.atmosphere.sources[area]
  const local = new THREE.Vector3(17, 5.5, -21).applyAxisAngle(new THREE.Vector3(0, 1, 0), a.heading)
  renderer.camera.position.set(a.x + local.x, a.y + local.y, a.z + local.z)
  renderer.camera.lookAt(a.x, a.y + 1.7, a.z)
}
frameArea()
document.querySelector('#area')!.addEventListener('click', () => { area = (area + 1) % track.atmosphere.sources.length; frameArea() })
document.querySelector('#quality')!.addEventListener('click', e => { quality = quality === 'high' ? 'low' : 'high'; (e.target as HTMLElement).textContent = `Quality: ${quality === 'high' ? 'High' : 'Low'}` })
document.querySelector('#motion')!.addEventListener('click', e => { motion = !motion; (e.target as HTMLElement).textContent = `Motion: ${motion ? 'On' : 'Off'}` })
document.querySelector('#audio')!.addEventListener('click', e => {
  ctx ??= new AudioContext(); void ctx.resume()
  ambience ??= new TracksideAmbience(ctx, ctx.destination); ambience.setAreas(track.atmosphere.sources)
  ;(e.target as HTMLElement).textContent = 'Trackside audio enabled'
})
document.querySelector('#pause')!.addEventListener('click', e => {
  paused = !paused; (e.target as HTMLElement).textContent = paused ? 'Resume' : 'Pause'
  if (paused) void ctx?.suspend(); else void ctx?.resume()
})
document.querySelector('#hide')!.addEventListener('click', e => { visible = !visible; (e.target as HTMLElement).textContent = visible ? 'Hide atmosphere (baseline)' : 'Show atmosphere' })
const output = document.querySelector('output')!, times: number[] = []
let last = performance.now(), statsAt = 0
function render(now: number) {
  const dt = Math.min((now - last) / 1000, .1); last = now
  const start = performance.now()
  track.setQuality(quality)
  track.atmosphere.update(renderer.camera.position, paused ? 0 : dt, visible, motion)
  renderer.camera.updateWorldMatrix(true, false)
  const m = renderer.camera.matrixWorld.elements
  ambience?.update(m[12], m[13], m[14], m[0], m[1], m[2], visible, .75)
  renderer.render()
  times.push(performance.now() - start); if (times.length > 300) times.shift()
  if (now - statsAt > 500) {
    statsAt = now
    const sorted = [...times].sort((a, b) => a - b), info = renderer.renderer.info.render
    output.textContent = `${backend.kind} · ${track.atmosphere.sources[area].label} · ${track.atmosphere.sources.length} areas\n${quality} · ${renderer.drawCalls} draw calls · ${info.triangles} triangles\nCPU update+submit median ${sorted[Math.floor(sorted.length * .5)].toFixed(2)} ms / p95 ${sorted[Math.floor(sorted.length * .95)].toFixed(2)} ms\nOriginal procedural geometry + trackside audio. No downloaded assets.`
  }
  requestAnimationFrame(render)
}
requestAnimationFrame(render)
window.addEventListener('pagehide', () => { ambience?.dispose(); void ctx?.close(); track.dispose(); world.free(); renderer.dispose() }, { once: true })
