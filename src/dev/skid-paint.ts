import * as THREE from 'three'
import { backend } from '../engine/backend'
import type { AnyRenderer } from '../engine/Renderer'
import { SkidMarks } from '../effects/SkidMarks'
import { withTrackLook } from '../world/TrackLook'
import { DEFAULT_VEHICLE_CONFIG } from '../vehicles/VehicleConfig'
import type { WheelState } from '../vehicles/VehicleController'
import { skidPaint } from '../effects/SkidPaint'
import { Surface } from '../vehicles/Surface'

const report = document.querySelector('#report')!
async function main() {
  let renderer: AnyRenderer
  if (new URLSearchParams(location.search).get('renderer') === 'webgpu') {
    backend.nodes = await import('../engine/nodes')
    renderer = new backend.nodes.WebGPURenderer({ antialias: true })
    await renderer.init(); backend.renderer = renderer; backend.kind = 'webgpu'
  } else renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(innerWidth, innerHeight)
  document.body.appendChild(renderer.domElement)
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x293848)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2))
  const sun = new THREE.DirectionalLight(0xffffff, 2); sun.position.set(3, 10, 2); scene.add(sun)
  const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, .1, 300)
  camera.position.set(22, 25, 28); camera.lookAt(0, 2, 0)
  const roadGeo = new THREE.PlaneGeometry(26, 42, 1, 16); roadGeo.rotateX(-Math.PI / 2)
  const pos = roadGeo.getAttribute('position')
  for (let i = 0; i < pos.count; i++) pos.setY(i, 2 + pos.getZ(i) * .12)
  roadGeo.computeVertexNormals()
  const road = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: .9 }); road.userData.layer = 'road'
  const material = withTrackLook(road)
  scene.add(new THREE.Mesh(roadGeo, material))
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(8, .3, 3), material); bridge.position.set(0, 5, 3); scene.add(bridge)
  const marks = new SkidMarks(); marks.setQuality('high')
  const focus = new THREE.Vector3()
  const wheels = DEFAULT_VEHICLE_CONFIG.wheels.map(cfg => ({ cfg, grounded: true, slide: 8, surface: Surface.Asphalt, contactPoint: new THREE.Vector3() } as WheelState))
  const advance = (x: number, z: number, surface: Surface = Surface.Asphalt, dt = .001) => {
    wheels.forEach((w, i) => { w.surface = surface; w.contactPoint.set(x + (i % 2 ? .8 : -.8), 2 + (z + Math.floor(i / 2) * .7) * .12, z + Math.floor(i / 2) * .7) })
    marks.update(wheels, dt); marks.render(renderer, focus)
  }
  const seed = () => {
    marks.clear()
    for (let i = 0; i < 100; i++) advance(-4, -16 + i * .3)
    wheels.forEach(w => { w.grounded = false }); advance(0, 0)
    wheels.forEach(w => { w.grounded = true })
    for (let i = 0; i < 100; i++) advance(4 + Math.sin(i * .05) * 2, -16 + i * .3, Surface.Sand)
    renderer.render(scene, camera)
  }
  async function pixel(x: number, z: number) {
    const size = marks.target.width
    const px = Math.floor(((x / 128 % 1 + 1) % 1) * size), py = Math.floor(((z / 128 % 1 + 1) % 1) * size)
    const data = backend.kind === 'webgpu'
      ? await (renderer as import('three/webgpu').WebGPURenderer).readRenderTargetPixelsAsync(marks.target, px, py, 1, 1)
      : await (renderer as THREE.WebGLRenderer).readRenderTargetPixelsAsync(marks.target, px, py, 1, 1, new Uint16Array(4))
    return Array.from(data, value => THREE.DataUtils.fromHalfFloat(value))
  }
  async function roadPixel(x: number, z: number, ready: number) {
    const target = new THREE.WebGLRenderTarget(32, 32)
    const camera = new THREE.OrthographicCamera(-.15, .15, .15, -.15, .1, 50)
    camera.up.set(0, 0, -1); camera.position.set(x, 20, z); camera.lookAt(x, 0, z)
    const previous = skidPaint.uSkidReady.value
    skidPaint.uSkidReady.value = ready
    renderer.setRenderTarget(target); renderer.render(scene, camera)
    const data = backend.kind === 'webgpu'
      ? await (renderer as import('three/webgpu').WebGPURenderer).readRenderTargetPixelsAsync(target, 16, 16, 1, 1)
      : await (renderer as THREE.WebGLRenderer).readRenderTargetPixelsAsync(target, 16, 16, 1, 1, new Uint8Array(4))
    renderer.setRenderTarget(null); target.dispose(); skidPaint.uSkidReady.value = previous
    return data[0] + data[1] + data[2]
  }
  async function verify() {
    const results: string[] = []
    const check = (ok: boolean, label: string) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${label}`); report.textContent = `${backend.kind}\n${results.join('\n')}` }
    seed()
    const dark = await roadPixel(-3.2, .1, 1), clean = await roadPixel(-3.2, .1, 0)
    check(dark < clean * .9, `road samples paint (${dark}/${clean})`)
    const bridgePaint = await roadPixel(-3.2, 3, 1), bridgeClean = await roadPixel(-3.2, 3, 0)
    check(bridgePaint === bridgeClean, 'elevated deck stays clean')
    const old = await pixel(-3.2, .1), rut = await pixel(4.4, -1)
    check(old[0] > .1 && Math.abs(old[1] - 2.012) < .1, `sloped rubber (R=${old[0].toFixed(3)}, Y=${old[1].toFixed(2)})`)
    check(rut[2] > .1, `loose-ground ruts (B=${rut[2].toFixed(3)})`)
    // 2800 fresh stamps elsewhere in the same cache must not evict the first trail.
    for (let i = 0; i < 700; i++) advance(8, -12 + (i % 70) * .3)
    const retained = await pixel(-3.2, .1)
    check(retained[0] > .1, `history survives 2800 new stamps (${retained[0].toFixed(3)})`)
    wheels.forEach(w => { w.grounded = false })
    marks.update(wheels, 12); marks.render(renderer, focus)
    const faded = await pixel(-3.2, .1)
    check(faded[0] < retained[0] * .2 && faded[0] > 0, 'GPU time fade')
    focus.x = 33; marks.render(renderer, focus)
    check((await pixel(-3.2, .1))[0] > 0, 'shared tiles survive cache movement')
    focus.x = 200; marks.render(renderer, focus)
    check((await pixel(-3.2, .1))[0] === 0, 'recycled tiles contain no stale rubber')
    marks.clear(); marks.render(renderer, focus)
    check((await pixel(8, .1))[0] === 0, 'race reset clears texture')
    focus.set(0, 0, 0); wheels.forEach(w => { w.grounded = true }); seed()
  }
  document.querySelector('#verify')!.addEventListener('click', () => { verify().catch(e => { report.textContent = String(e); console.error(e) }) })
  document.querySelector('#clear')!.addEventListener('click', () => { marks.clear(); marks.render(renderer, focus); renderer.render(scene, camera) })
  seed(); report.textContent = `${backend.kind}: ready`
}
main().catch(e => { report.textContent = String(e); console.error(e) })
