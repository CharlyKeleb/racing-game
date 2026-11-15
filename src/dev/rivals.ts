// Dev page: every car's Low model (back row) beside its rival LOD (front row),
// both painted as rivals, with draw calls and triangles. /src/dev/rivals.html
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { AssetManager } from '../engine/AssetManager'
import { rivalMaterial } from '../vehicles/RivalPaint'
import { selectableCars } from '../vehicles/carRegistry'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(2, devicePixelRatio))
renderer.setSize(innerWidth, innerHeight)
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.appendChild(renderer.domElement)
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x8a96a3)
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture
const sun = new THREE.DirectionalLight(0xffffff, 2)
sun.position.set(-10, 20, 10)
scene.add(sun, new THREE.HemisphereLight(0xffffff, 0x445544, 0.6))
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 60), new THREE.MeshStandardMaterial({ color: 0x3a3f46, roughness: 0.9 }))
ground.rotation.x = -Math.PI / 2
scene.add(ground)
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 500)

const COLOURS = [0x27b8eb, 0xffd447, 0xe64f67]
const assets = new AssetManager()
const cars = selectableCars().filter(car => car.modelUrlRival)
const stats: string[] = []
function count(root: THREE.Object3D): string {
  let calls = 0, tris = 0
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    calls += Array.isArray(mesh.material) ? mesh.material.length : 1
    tris += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3
  })
  return `${calls} calls / ${Math.round(tris / 1000)}k tris`
}
await Promise.all(cars.map(async (car, i) => {
  const colour = COLOURS[i % COLOURS.length]
  const [low, rival] = await Promise.all([assets.loadModel(car.modelUrlLow ?? car.modelUrl), assets.loadModel(car.modelUrlRival!)])
  for (const [model, z] of [[low, 6], [rival, 0]] as const) {
    model.traverse(o => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) mesh.material = Array.isArray(mesh.material) ? mesh.material.map(m => rivalMaterial(m, car.id, colour)) : rivalMaterial(mesh.material, car.id, colour)
    })
    model.position.set((i - (cars.length - 1) / 2) * -3.2, 0, z)
    model.rotation.y = Math.PI * 0.85
    scene.add(model)
  }
  stats[i] = `${car.id}: low ${count(low)} → rival ${count(rival)}`
}))
document.querySelector('output')!.textContent = stats.join('\n')

const params = new URLSearchParams(location.search)
const focus = Number(params.get('car') ?? -1)
function frame(): void {
  const x = focus >= 0 ? (focus - (cars.length - 1) / 2) * -3.2 : 0
  const distance = focus >= 0 ? 9 : 26
  camera.position.set(x + distance * 0.35, distance * 0.3, -distance)
  camera.lookAt(x, 0.6, 3)
  renderer.render(scene, camera)
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); frame() })
frame()
