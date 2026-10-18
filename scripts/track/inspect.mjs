// Dumps node hierarchy, materials, textures and per-mesh stats of a GLB.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { getBounds } from '@gltf-transform/core'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(process.argv[2])
const root = doc.getRoot()

const tris = (mesh) => mesh.listPrimitives().reduce((n, p) => n + (p.getIndices() ? p.getIndices().getCount() : p.getAttribute('POSITION').getCount()) / 3, 0)

console.log('== nodes')
const walk = (node, depth) => {
  const mesh = node.getMesh()
  let info = ''
  if (mesh) {
    const b = getBounds(node)
    const size = b.max.map((v, i) => (v - b.min[i]).toFixed(0)).join('x')
    const mats = [...new Set(mesh.listPrimitives().map((p) => p.getMaterial()?.getName()))].join(',')
    info = ` tris=${tris(mesh)} size=${size} min=${b.min.map((v) => v.toFixed(0))} mat=${mats}`
  }
  if (depth < 4 || mesh) console.log(' '.repeat(depth * 2) + node.getName() + info + (node.getScale().some(s=>s!==1) ? ` scale=${node.getScale()}` : '') + (node.getRotation().some((r,i)=>r!==(i===3?1:0)) ? ` rot=${node.getRotation().map(v=>v.toFixed(3))}` : ''))
  node.listChildren().forEach((c) => walk(c, depth + 1))
}
root.listScenes().forEach((s) => s.listChildren().forEach((n) => walk(n, 0)))

console.log('== materials')
for (const m of root.listMaterials()) {
  const tex = ['getBaseColorTexture', 'getNormalTexture', 'getMetallicRoughnessTexture', 'getEmissiveTexture', 'getOcclusionTexture']
    .map((f) => m[f]()?.getName() || m[f]()?.getURI()).filter(Boolean)
  console.log(`${m.getName()} alpha=${m.getAlphaMode()} color=${m.getBaseColorFactor().map((v) => v.toFixed(2))} tex=${tex.join('|')}`)
}
console.log('== textures')
let total = 0
for (const t of root.listTextures()) {
  const size = t.getSize()
  const bytes = t.getImage()?.byteLength ?? 0
  total += bytes
  console.log(`${t.getName() || t.getURI()} ${t.getMimeType()} ${size?.join('x')} ${(bytes / 1e6).toFixed(2)}MB`)
}
console.log(`textures total ${(total / 1e6).toFixed(1)}MB, count ${root.listTextures().length}`)
