// Turns a downloaded Sketchfab car (glTF folder or .glb) into a traffic GLB for StreetLife:
// every node's transform baked, nose turned to +Z, kept to scale (or scaled to `--length` metres), centred on x/z
// with the wheels on y = 0, materials matching `--drop` removed (interiors: a draw call nobody sees
// from outside), one mesh per material, simplified to about `triangles`, textures
// shrunk to WebP and meshopt-compressed. No wheel rig: traffic cars don't steer or spin wheels.
//
// usage: node scripts/traffic/prepare-traffic.mjs <scene.gltf|.glb> <out.glb> [--rotate 0|90|180|270] [--length m] [--triangles 6000] [--texture 1024] [--drop regex]
import { statSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, getBounds, join, meshopt, prune, simplifyPrimitive, textureCompress, transformMesh, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const [input, output, ...flags] = process.argv.slice(2)
if (!input || !output) throw new Error('usage: prepare-traffic.mjs <in> <out.glb> [--rotate deg] [--length m] [--triangles n] [--texture px]')
const flag = (name, fallback) => {
  const i = flags.indexOf(`--${name}`)
  return i >= 0 ? Number(flags[i + 1]) : fallback
}
const dropIndex = flags.indexOf('--drop')
const drop = dropIndex >= 0 ? new RegExp(flags[dropIndex + 1], 'i') : null
const rotate = flag('rotate', 0), length = flag('length', 0), targetTriangles = flag('triangles', 6000), textureSize = flag('texture', 1024)

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
const doc = await io.read(input)
const root = doc.getRoot()
const scene = root.getDefaultScene() ?? root.listScenes()[0]

const multiply = (a, b) => {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}
const turn = (deg) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]
}

if (drop) for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) if (drop.test(p.getMaterial()?.getName() ?? '')) p.dispose()

// ── 1. Bake each mesh node's world transform (a mesh shared by nodes is copied per node) ──
const baked = new Set()
const holder = doc.createNode('traffic')
for (const node of root.listNodes()) {
  let mesh = node.getMesh()
  if (!mesh || node === holder) continue
  if (baked.has(mesh)) {
    const copy = doc.createMesh(mesh.getName())
    for (const p of mesh.listPrimitives()) copy.addPrimitive(p.clone())
    mesh = copy
  }
  baked.add(mesh)
  transformMesh(mesh, multiply(turn(rotate), node.getWorldMatrix()))
  holder.addChild(doc.createNode(node.getName()).setMesh(mesh))
}
for (const node of root.listNodes()) if (node !== holder && !holder.listChildren().includes(node)) node.dispose()
for (const s of root.listScenes()) if (s !== scene) s.dispose()
scene.addChild(holder)

// ── 2. Scale to `length` along Z, centre on x/z, wheels on the ground ──
let [min, max] = [getBounds(scene).min, getBounds(scene).max]
const scale = length > 0 ? length / (max[2] - min[2]) : 1
const cx = (min[0] + max[0]) / 2, cz = (min[2] + max[2]) / 2
const place = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, -cx * scale, -min[1] * scale, -cz * scale, 1]
for (const node of holder.listChildren()) transformMesh(node.getMesh(), place)
;[min, max] = [getBounds(scene).min, getBounds(scene).max]

// ── 3. One mesh per material, simplified, textures shrunk, compressed ──
await doc.transform(prune(), dedup(), weld(), join())
const prims = root.listMeshes().flatMap((m) => m.listPrimitives())
const triangles = () => prims.reduce((sum, p) => sum + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0)
const before = triangles()
const ratio = Math.min(1, targetTriangles / before)
if (ratio < 1) for (const p of prims) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.02, lockBorder: false })
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [textureSize, textureSize], quality: 80 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
)
await io.write(output, doc)
const size = (v) => v.map((x) => x.toFixed(2)).join(' × ')
console.log(`${output}: ${Math.round(before)} → ${Math.round(triangles())} triangles, ${root.listMaterials().length} materials, ${size([max[0] - min[0], max[1] - min[1], max[2] - min[2]])} m, ${(statSync(output).size / 1e6).toFixed(2)} MB`)
