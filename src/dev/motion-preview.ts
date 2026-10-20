import * as THREE from 'three'
import { Renderer } from '../engine/Renderer'
import { MotionVectors } from '../effects/MotionVectors'
const renderer = new Renderer(document.querySelector('#view')!, new URLSearchParams(location.search).get('renderer') === 'webgpu' ? 'webgpu' : 'webgl')
await renderer.init()
renderer.applyQuality('medium', true)
const { scene, camera } = renderer
camera.position.set(0, 3, 8)
camera.lookAt(0, 0, 0)
scene.background = new THREE.Color('#152435')
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 3))
const road = new THREE.Mesh(new THREE.BoxGeometry(18, .1, 80), new THREE.MeshStandardMaterial({ color: '#455566' }))
road.position.y = -.8
scene.add(road)
for (let i = 0; i < 30; i++) {
  const marker = new THREE.Mesh(new THREE.BoxGeometry(.2, .03, .8), new THREE.MeshBasicMaterial({ color: 'white' }))
  marker.position.set(0, -.73, 12 - i * 2)
  scene.add(marker)
}
const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, .8, 3), new THREE.MeshStandardMaterial({ color: '#ffbb00' }))
scene.add(body)
const wheel = new THREE.Group()
wheel.position.set(1.05, -.35, 1)
scene.add(wheel)
for (let i = 0; i < 8; i++) {
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(.12, .8, .08), new THREE.MeshBasicMaterial({ color: i % 2 ? 'white' : '#202020' }))
  spoke.rotation.x = i * Math.PI / 8
  wheel.add(spoke)
}
const vectors = new MotionVectors()
vectors.setSize(256, 256)
vectors.capture(renderer.renderer, scene, camera, body)
vectors.capture(renderer.renderer, scene, camera, body)
const read = async () => {
  const data = renderer.renderer instanceof THREE.WebGLRenderer
    ? await renderer.renderer.readRenderTargetPixelsAsync(vectors.target, 0, 0, 256, 256, new Uint16Array(256 * 256 * 4))
    : await renderer.renderer.readRenderTargetPixelsAsync(vectors.target, 0, 0, 256, 256)
  const result = { maxMotion: 0, protectedPixels: 0, movingPixels: 0, finite: true }
  // Half-float targets return binary16 values.
  for (let i = 0; i < data.length; i += 4) {
    const r = THREE.DataUtils.fromHalfFloat(data[i])
    const g = THREE.DataUtils.fromHalfFloat(data[i + 1])
    const b = THREE.DataUtils.fromHalfFloat(data[i + 2])
    result.finite &&= Number.isFinite(r) && Number.isFinite(g)
    result.maxMotion = Math.max(result.maxMotion, Math.abs(r), Math.abs(g))
    if (b > .5) result.protectedPixels++
    if (Math.hypot(r, g) > .0001) result.movingPixels++
  }
  return result
}
const stationary = await read()
wheel.rotation.x += .25
vectors.capture(renderer.renderer, scene, camera, body)
const spinning = await read()
camera.position.x += .3
body.position.x += .3
wheel.rotation.x += .25
vectors.capture(renderer.renderer, scene, camera, body)
const moving = await read()
camera.position.x += 40
const cut = vectors.capture(renderer.renderer, scene, camera, body)
camera.position.x -= 40
vectors.dispose()
const report = { backend: renderer.backendName, stationary, spinning, moving, cutRejected: !cut }
document.querySelector('#report')!.textContent = JSON.stringify(report, null, 2)
let last = performance.now()
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, .05)
  last = now
  const dx = dt * 12
  camera.position.x += dx
  body.position.x += dx
  wheel.position.x += dx
  wheel.rotation.x += dt * 15
  if (camera.position.x > 4) { camera.position.x -= 8; body.position.x -= 8; wheel.position.x -= 8 }
  renderer.setMotionBlur(.7, body)
  renderer.render()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
