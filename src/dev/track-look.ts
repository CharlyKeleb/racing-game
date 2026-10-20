import * as THREE from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { Renderer } from '../engine/Renderer'
import { AssetManager } from '../engine/AssetManager'
import { backend } from '../engine/backend'
import { StreamedTrack } from '../world/StreamedTrack'
import { Track } from '../world/Track'
import { getTrack } from '../world/tracks'
import type { RaceTrack } from '../world/RaceTrack'
import { setTrackLook, type TrackLook } from '../world/TrackLook'
import type { QualityPreset } from '../stores/gameStore'
import { RainSurface } from '../effects/RainSurface'
import { WetRoads } from '../effects/WetRoads'

const renderer = new Renderer(document.querySelector('#view')!, new URLSearchParams(location.search).get('renderer') === 'webgpu' ? 'webgpu' : 'webgl')
await renderer.init(); renderer.applyQuality('low', false)
await RAPIER.init()
const assets = new AssetManager(), route = document.querySelector<HTMLSelectElement>('#route')!, look = document.querySelector<HTMLSelectElement>('#look')!
const quality = document.querySelector<HTMLSelectElement>('#quality')!, wet = document.querySelector<HTMLInputElement>('#wet')!, status = document.querySelector('output')!
const selected = new URLSearchParams(location.search).get('track')
if (selected && Array.from(route.options).some(o => o.value === selected)) route.value = selected
const scene = renderer.scene, camera = renderer.camera
scene.background = new THREE.Color('#a3bbc9'); scene.fog = new THREE.Fog('#a3bbc9', 350, 950)
scene.add(new THREE.HemisphereLight(0xe7efff, 0x68735c, 2.4))
const sun = new THREE.DirectionalLight(0xffecd3, 2.5); sun.position.set(70, 120, -30); scene.add(sun)
let world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }), track: RaceTrack | null = null, loading = false
let field = new RainSurface(), roads = new WetRoads(field.uniforms)
async function load() {
  if (loading) return
  loading = true; route.disabled = true; quality.disabled = true; status.textContent = 'Loading track'
  roads.dispose(); field.dispose(); track?.dispose(); world.free()
  track = null; world = new RAPIER.World({ x: 0, y: -9.81, z: 0 }); field = new RainSurface(); roads = new WetRoads(field.uniforms)
  try {
    const def = getTrack(route.value), q = quality.value as QualityPreset
    track = def.kind === 'procedural' ? new Track(def, world) : await StreamedTrack.load(def.manifestUrl, { assets, renderer: renderer.renderer, camera, scene, world, quality: q })
    const spawn = track.spawn, dir = new THREE.Vector3(Math.sin(spawn.heading), 0, Math.cos(spawn.heading))
    camera.position.copy(spawn.position).addScaledVector(dir, -24).add(new THREE.Vector3(0, 9, 0))
    camera.lookAt(spawn.position.clone().addScaledVector(dir, 35))
    scene.add(track.group)
    await track.setQuality(q); await track.loadVisuals?.()
  } catch (e) { status.textContent = String(e); throw e }
  finally { loading = false; route.disabled = false; quality.disabled = false }
}
route.onchange = () => void load(); quality.onchange = () => void load()
look.onchange = () => setTrackLook(look.value as TrackLook)
await load()
const velocity = new THREE.Vector3()
let previous = performance.now(), sampledAt = 0
function render(now: number) {
  const dt = Math.min((now - previous) / 1000, .05); previous = now
  if (track && !loading) {
    track.update(track.spawn.position, velocity, dt)
    track.atmosphere?.update(camera.position, dt, true)
    field.update(renderer.renderer, scene, track.group, camera, wet.checked ? 1 : 0, dt)
    roads.update(track.group, wet.checked ? 1 : 0, dt)
  }
  renderer.render()
  if (now - sampledAt > 500 && track && !loading) {
    sampledAt = now
    status.textContent = `${backend.kind} · ${track.name} · ${look.selectedOptions[0].text}\n${quality.value} · ${renderer.drawCalls} draw calls · ${renderer.renderer.info.render.triangles} triangles · ${wet.checked ? 'wet' : 'dry'}\nNo persisted settings changed. Both presets share geometry, textures and lighting.`
  }
  requestAnimationFrame(render)
}
requestAnimationFrame(render)
window.addEventListener('pagehide', () => { roads.dispose(); field.dispose(); track?.dispose(); world.free(); assets.dispose(); renderer.dispose() }, { once: true })
