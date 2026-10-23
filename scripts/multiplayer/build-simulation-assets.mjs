// Trusted offline asset export. Never loads GLBs or client car builds in a race tick.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { Vector3, Matrix4 } from 'three'
import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const carIds = ['porsche911', 'koenigsegg', 'bmw', 'diablo', 'amg', 'charger']

export async function buildSimulationAssets() {
  const hash = createHash('sha256')
  async function source(relative) {
    const bytes = await readFile(path.join(root, relative))
    hash.update(relative).update('\0').update(bytes).update('\0')
    return bytes
  }
  const manifest = JSON.parse(await source('public/models/tracks/nurburgring/track.json'))
  const collision = await source(`public/models/tracks/nurburgring/${manifest.collision}`)
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  await MeshoptDecoder.ready
  const document = await io.readBinary(collision)
  const meshes = []
  const point = new Vector3()
  const matrix = new Matrix4()
  const scene = document.getRoot().listScenes()[0]
  if (!scene) throw new Error('Collision asset has no scene')
  scene.traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    matrix.fromArray(node.getWorldMatrix())
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION')
      const index = primitive.getIndices()
      if (!positions || !index || primitive.getMode() !== 4) throw new Error('Collision requires indexed triangles')
      const vertices = new Array(positions.getCount() * 3)
      for (let i = 0; i < positions.getCount(); i++) {
        const element = positions.getElement(i, [])
        point.fromArray(element).applyMatrix4(matrix)
        vertices[i * 3] = Math.fround(point.x)
        vertices[i * 3 + 1] = Math.fround(point.y)
        vertices[i * 3 + 2] = Math.fround(point.z)
      }
      // Three's GLTFLoader uses the node name for the collision mesh.
      meshes.push({ vertices, indices: Array.from(index.getArray()), barrier: node.getName().startsWith('barrier') })
    }
  })
  if (!meshes.length) throw new Error('Collision asset has no triangles')
  // Decode using the runtime's format; reject truncated/corrupt build data.
  let surface = null
  if (manifest.surface) {
    const bytes = await source(`public/models/tracks/nurburgring/${manifest.surface.url}`)
    const cells = []
    for (let i = 0; i < bytes.length;) {
      const code = bytes[i++]
      let run = 0, shift = 0, b
      do {
        if (i >= bytes.length || shift > 28) throw new Error('Invalid surface RLE')
        b = bytes[i++]
        run += (b & 127) * 2 ** shift
        shift += 7
      } while (b & 128)
      if (code > 5 || !run || cells.length + run > manifest.surface.width * manifest.surface.height) throw new Error('Invalid surface run')
      for (let j = 0; j < run; j++) cells.push(code)
    }
    if (cells.length !== manifest.surface.width * manifest.surface.height) throw new Error('Incomplete surface grid')
    surface = { info: manifest.surface, cells }
  }
  const cars = {}
  for (const id of carIds) cars[id] = JSON.parse(await source(`public/models/cars/${id}/vehicle-config.json`))
  // Conservative fingerprint: also invalidates on cosmetic vehicle changes.
  for (const dir of ['src/vehicles', 'src/simulation']) {
    for (const name of (await readdir(path.join(root, dir))).filter((name) => name.endsWith('.ts')).sort()) await source(`${dir}/${name}`)
  }
  for (const file of ['src/engine/PhysicsWorld.ts', 'src/racing/LaunchControl.ts', 'src/world/SurfaceMap.ts', 'package-lock.json']) await source(file)
  return {
    format: 1,
    fingerprint: hash.digest('hex'),
    track: { id: manifest.id, spawn: { position: { x: manifest.spawn.position[0], y: manifest.spawn.position[1], z: manifest.spawn.position[2] }, heading: manifest.spawn.heading },
      line: manifest.line.map(([x, y, z]) => ({ x, y, z })), checkpoints: manifest.checkpoints, meshes, surface },
    cars,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ?? path.join(root, '.cache/multiplayer/simulation-assets.json')
  const assets = await buildSimulationAssets()
  await mkdir(path.dirname(output), { recursive: true })
  await writeFile(output, JSON.stringify(assets))
  console.log(JSON.stringify({ output, fingerprint: assets.fingerprint, meshes: assets.track.meshes.length, cars: Object.keys(assets.cars) }))
}
