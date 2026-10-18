// Prints a car GLB's per-mesh bounds in glTF world space (meters, +Y up), after
// baking the node hierarchy. usage: node scripts/cars/inspect-car.mjs <file.glb>
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/functions'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(process.argv[2])
const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
const all = getBounds(scene)
const fmt = (v) => v.map((n) => n.toFixed(3)).join(', ')
console.log('scene bounds min', fmt(all.min), 'max', fmt(all.max))
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const b = getBounds(node)
  const tris = mesh.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0)
  console.log(`${node.getName()} tris=${tris} min ${fmt(b.min)} max ${fmt(b.max)}`)
}
