import { WetReflections } from '../effects/WetReflections'
import { AssetManager } from '../engine/AssetManager'
import { rigCarModel, type CarModel } from '../vehicles/CarModel'
import { CarLivery } from '../vehicles/CarLivery'
import { DEFAULT_BUILD } from '../vehicles/CarBuild'
import type { VehicleConfig } from '../vehicles/VehicleConfig'
import { CarRain } from '../effects/CarRain'
/** Isolated visual/height-readback regression fixture: npm run dev → /src/dev/rain-preview.html. */
import * as THREE from 'three'
import { backend } from '../engine/backend'
import type { AnyRenderer } from '../engine/Renderer'
import { RainSurface } from '../effects/RainSurface'
import { RainImpacts } from '../effects/RainImpacts'
import { WetRoads } from '../effects/WetRoads'
import { Rain } from '../effects/Rain'

async function run() {
  let renderer: AnyRenderer
  if (new URLSearchParams(location.search).get('renderer') === 'webgpu') {
    const nodes = await import('../engine/nodes')
    const gpu = new nodes.WebGPURenderer({ antialias: true })
    await gpu.init()
    backend.kind = 'webgpu'; backend.nodes = nodes; backend.renderer = gpu
    renderer = gpu
  } else renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(innerWidth, innerHeight * .85)
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  document.body.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#586977')
  scene.add(new THREE.HemisphereLight(0xc2d9ea, 0x303431, 2))
  const light = new THREE.DirectionalLight(0xffe4c1, 3)
  light.position.set(3, 10, 5); scene.add(light)
  const track = new THREE.Group(); scene.add(track)
  const geometry = new THREE.PlaneGeometry(28, 28, 12, 12)
  geometry.rotateX(-Math.PI / 2)
  const vertices = geometry.getAttribute('position')
  for (let i = 0; i < vertices.count; i++) vertices.setY(i, vertices.getX(i) * .1)
  geometry.computeVertexNormals()
  const low = new URLSearchParams(location.search).get('quality') === 'low'
  const roadMaterial = low && !backend.nodes
    ? new THREE.MeshLambertMaterial({ color: '#4d5258' })
    : new THREE.MeshStandardMaterial({ color: '#4d5258', roughness: .9 })
  roadMaterial.userData.layer = 'road'
  track.add(new THREE.Mesh(geometry, roadMaterial))
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4, .2, 4), new THREE.MeshStandardMaterial({ color: '#b5875a' }))
  roof.position.set(-3, 2, 0); track.add(roof)
  const camera = new THREE.PerspectiveCamera(48, innerWidth / (innerHeight * .85), .1, 100)
  camera.position.set(8, 7, 12); camera.lookAt(-1, 0, 0)
  const field = new RainSurface()
  const impacts = new RainImpacts(field.uniforms)
  const reflections = new WetReflections()
  reflections.setQuality(low ? 'low' : 'high')
  const reflectionAnchor = new THREE.Vector3()
  const roads = new WetRoads(field.uniforms, reflections.uniforms)
  const rain = new Rain(field.uniforms)
  scene.add(impacts.mesh, rain.mesh)
  let car: CarModel | undefined, carRain: CarRain | undefined
  if (new URLSearchParams(location.search).get('car') === '1') {
    const assets = new AssetManager()
    const [model, config] = await Promise.all([
      assets.loadModel('/models/cars/porsche911/porsche911.glb'),
      fetch('/models/cars/porsche911/vehicle-config.json').then(response => response.json() as Promise<VehicleConfig>),
    ])
    car = rigCarModel(model, config)
    for (const wheel of config.wheels) car.wheels[wheel.id].pivot.position.set(...wheel.position)
    new CarLivery(car).apply({ ...DEFAULT_BUILD, finish: new URLSearchParams(location.search).get('finish') === 'pearl' ? 'pearl' : 'metallic' })
    car.root.position.set(3, .3, 3)
    scene.add(car.root)
    carRain = new CarRain(car, field.uniforms)
    scene.add(carRain.impacts.mesh)
    camera.position.set(4.4, 2.2, -2.2)
    camera.lookAt(3, .9, 3)
  }
  const status = document.querySelector<HTMLOutputElement>('#status')!
  const checkbox = document.querySelector<HTMLInputElement>('#wet')!
  let lastTime = performance.now()
  let checked = false, frames = 0
  async function readHeight(x: number, z: number) {
    const bounds = field.uniforms.uRainBounds.value
    const px = Math.floor(((x - bounds.x) / bounds.w + .5) * field.target.width)
    const py = Math.floor((.5 - (z - bounds.z) / bounds.w) * field.target.height)
    let sample: number
    if (renderer instanceof THREE.WebGLRenderer) {
      const pixels = new Uint16Array(4)
      renderer.readRenderTargetPixels(field.target, px, py, 1, 1, pixels)
      sample = THREE.DataUtils.fromHalfFloat(pixels[0])
    } else {
      // Also verify the node sampler's render-target Y convention, not just the raw capture.
      const [{ MeshBasicNodeMaterial }, { vec2, vec3 }, { surfaceHeight }] = await Promise.all([
        import('three/webgpu'), import('three/tsl'), import('../engine/nodes/rainSurface'),
      ])
      const material = new MeshBasicNodeMaterial({ toneMapped: false, fog: false })
      material.colorNode = vec3(surfaceHeight(field.uniforms, vec2(x, z)).sub(bounds.y).div(128).add(.5), 0, 0)
      const sampleScene = new THREE.Scene()
      const plane = new THREE.PlaneGeometry(2, 2)
      sampleScene.add(new THREE.Mesh(plane, material))
      const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 10)
      sampleCamera.position.z = 1
      const sampleTarget = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType })
      await renderer.compileAsync(sampleScene, sampleCamera)
      const oldTarget = renderer.getRenderTarget()
      renderer.setRenderTarget(sampleTarget)
      renderer.render(sampleScene, sampleCamera)
      renderer.setRenderTarget(oldTarget)
      const pixels = await renderer.readRenderTargetPixelsAsync(sampleTarget, 0, 0, 1, 1)
      sample = pixels instanceof Float32Array ? pixels[0] : THREE.DataUtils.fromHalfFloat(pixels[0])
      sampleTarget.dispose(); plane.dispose(); material.dispose()
    }
    return (sample - .5) * 128 + bounds.y
  }
  renderer.setAnimationLoop(() => {
    const now = performance.now()
    const dt = (now - lastTime) / 1000, wet = checkbox.checked ? 1 : 0
    lastTime = now
    field.update(renderer, scene, track, camera, wet, dt)
    roads.update(track, wet, dt)
    reflections.update(renderer, scene, track, camera, reflectionAnchor, wet, dt)
    rain.update(camera, wet, dt)
    impacts.mesh.visible = wet > 0
    if (car && carRain) carRain.update(car, wet, dt)
    renderer.render(scene, camera)
    if (++frames > 50 && !checked) {
      checked = true
      void Promise.all([readHeight(-3, 0), readHeight(4, 0)]).then(([roofHeight, slopeHeight]) => {
        const okay = Math.abs(roofHeight - 2.1) < .12 && Math.abs(slopeHeight - .4) < .12
        status.textContent = `${okay ? 'PASS' : 'FAIL'} · ${backend.kind} · roof ${roofHeight.toFixed(2)}m (2.10) · slope ${slopeHeight.toFixed(2)}m (0.40)`
      }).catch(error => { status.textContent = `FAIL · ${String(error)}` })
    }
  })
}
void run().catch(error => { document.querySelector('#status')!.textContent = `FAIL · ${String(error)}` })
