// Turns a downloaded car GLB into the game's car contract (docs/ASSET_PIPELINE.md)
// without Blender: bake transforms to meters with the nose at +Z, split the
// wheels out of shared meshes, name nodes and materials, decimate to budget and
// compress textures.
//
// usage: node scripts/cars/prepare-car.mjs <car config .mjs> <source .glb>
//   e.g. node scripts/cars/prepare-car.mjs scripts/cars/koenigsegg.config.mjs ~/Downloads/koenigsegg_one_pro.glb
//
// Writes <outDir>/<id>.glb and <id>_low.glb (meshopt-compressed) and prints
// the measured wheel and chassis numbers for vehicle-config.json.
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { cloneDocument, dedup, getBounds, meshopt, prune, simplifyPrimitive, textureCompress, transformMesh, weld } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const [configPath, sourcePath] = process.argv.slice(2)
if (!configPath || !sourcePath) {
  console.error('usage: node scripts/cars/prepare-car.mjs <config.mjs> <source.glb>')
  process.exit(1)
}
const cfg = (await import(pathToFileURL(resolve(configPath)).href)).default

await MeshoptEncoder.ready
await MeshoptSimplifier.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const doc = await io.read(sourcePath)
const root = doc.getRoot()
const scene = root.getDefaultScene() ?? root.listScenes()[0]
const buffer = root.listBuffers()[0]

// ── 1. Bake every mesh node's world transform, then rotate and scale ────────
// Car contract: meters, +Y up, nose +Z (+X is the car's left), origin on the
// ground under the wheelbase centre. cfg.rotateY turns the nose to +Z.
const s = cfg.scale
const ry = ((cfg.rotateY ?? 0) * Math.PI) / 180
const c = Math.cos(ry)
const sn = Math.sin(ry)
const place = [s * c, 0, -s * sn, 0, 0, s, 0, 0, s * sn, 0, s * c, 0, 0, 0, 0, 1]
const meshNodes = root.listNodes().filter((n) => n.getMesh())
const parts = [] // { name, mesh }
for (const node of meshNodes) {
  const mesh = node.getMesh()
  transformMesh(mesh, multiply(place, node.getWorldMatrix()))
  parts.push({ name: node.getName(), mesh })
}
for (const node of root.listNodes()) node.dispose()

/** Parts match by node name or material name (some models are one mesh, many materials). */
const matches = (re, nodeName, prim) => re.test(nodeName) || re.test(prim.getMaterial()?.getName() ?? '')
const quad = (x, z) => (z > 0 ? 'F' : 'R') + (x > 0 ? 'L' : 'R') // +X is the car's left

// ── 2. Measure the wheels from the tyres: one per quadrant ───────────────────
function measureWheels() {
  const found = {}
  for (const { name, mesh } of parts) {
    for (const prim of mesh.listPrimitives()) {
      if (!matches(cfg.wheelParts.tyre, name, prim)) continue
      const pos = prim.getAttribute('POSITION').getArray()
      for (let i = 0; i < pos.length; i += 3) {
        const id = quad(pos[i], pos[i + 2])
        const w = (found[id] ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] })
        for (let a = 0; a < 3; a++) {
          w.min[a] = Math.min(w.min[a], pos[i + a])
          w.max[a] = Math.max(w.max[a], pos[i + a])
        }
      }
    }
  }
  for (const w of Object.values(found)) {
    w.center = w.min.map((v, a) => (v + w.max[a]) / 2)
    w.radius = (w.max[1] - w.min[1]) / 2
    w.width = w.max[0] - w.min[0]
  }
  return found
}
// Ground the tyres and centre the wheelbase, then measure again.
{
  const w0 = measureWheels()
  const ground = Math.min(...Object.values(w0).map((w) => w.min[1]))
  const midZ = (w0.FL.center[2] + w0.RL.center[2]) / 2
  const midX = (w0.FL.center[0] + w0.FR.center[0]) / 2
  const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -midX, -ground, -midZ, 1]
  for (const { mesh } of parts) transformMesh(mesh, shift)
}
const wheels = measureWheels()

// ── 3. Split meshes into the contract's nodes ────────────────────────────────
// Each output node collects primitives; wheel primitives get re-centred on the
// axle so the wheel spins about its origin.
const out = { Chassis: [], Headlights: [], Taillights: [], Wheel_FL: [], Wheel_FR: [], Wheel_RL: [], Wheel_RR: [] }
const caliperMaterials = new Map()
const lightMaterials = new Map()

for (const { name, mesh } of parts) {
  for (const prim of mesh.listPrimitives()) {
    const isTyreOrRim = matches(cfg.wheelParts.tyre, name, prim) || matches(cfg.wheelParts.rim, name, prim)
    const isBrake = cfg.wheelParts.brake && matches(cfg.wheelParts.brake, name, prim)
    const isLights = cfg.lights && matches(cfg.lights, name, prim)
    if (isTyreOrRim) {
      for (const [id, tris] of groupTriangles(prim, (c) => quad(c[0], c[2]))) addWheel(id, subset(prim, tris))
    } else if (isBrake) {
      // Discs are round about the axle and spin; calipers sit off to one side
      // and stay on the chassis.
      for (const comp of components(prim)) {
        const c = comp.center
        const id = quad(c[0], c[2])
        const w = wheels[id]
        const off = Math.hypot(c[1] - w.center[1], c[2] - w.center[2])
        const extent = Math.max(comp.size[1], comp.size[2]) / 2
        const sub = subset(prim, comp.tris)
        if (off < 0.25 * Math.max(extent, 1e-6) && extent > 0.3 * w.radius) addWheel(id, sub)
        else {
          sub.setMaterial(caliperMaterial(prim.getMaterial()))
          out.Chassis.push(sub)
        }
      }
    } else if (isLights) {
      for (const [end, tris] of groupTriangles(prim, (c) => (c[2] > 0 ? 'front' : 'rear'))) {
        const sub = subset(prim, tris)
        sub.setMaterial(lightMaterial(prim.getMaterial(), end))
        out[end === 'front' ? 'Headlights' : 'Taillights'].push(sub)
      }
    } else {
      out.Chassis.push(prim)
    }
  }
}

function addWheel(id, prim) {
  const w = wheels[id]
  const [cx, cy, cz] = w.center
  const pos = prim.getAttribute('POSITION')
  const a = pos.getArray().slice()
  for (let i = 0; i < a.length; i += 3) {
    a[i] -= cx
    a[i + 1] -= cy
    a[i + 2] -= cz
  }
  pos.setArray(a)
  out[`Wheel_${id}`].push(prim)
}

function caliperMaterial(base) {
  if (!caliperMaterials.has(base)) caliperMaterials.set(base, base.clone().setName('caliper'))
  return caliperMaterials.get(base)
}

function lightMaterial(base, end) {
  const key = base.getName() + end
  if (!lightMaterials.has(key)) lightMaterials.set(key, base.clone().setName(end === 'front' ? 'headlight' : 'taillight'))
  return lightMaterials.get(key)
}

// Rename materials the runtime matches by name (paint, rims; see CarLivery),
// and fix alpha modes: exporters that mark everything BLEND make the whole
// car sort as transparent. cfg.alpha: { name: 'BLEND' | 'MASK' } keeps those.
for (const mat of root.listMaterials()) {
  if (cfg.opaqueUnlessListed) {
    const keep = cfg.alpha?.[mat.getName()] ?? (mat.getBaseColorFactor()[3] < 0.99 ? 'BLEND' : 'OPAQUE')
    mat.setAlphaMode(keep)
    if (keep === 'MASK') mat.setAlphaCutoff(0.5)
  }
  const rename = cfg.materialNames[mat.getName()]
  if (rename) mat.setName(rename)
}

const carRoot = doc.createNode(cfg.id)
scene.addChild(carRoot)
for (const [nodeName, prims] of Object.entries(out)) {
  if (!prims.length) continue
  const mesh = doc.createMesh(nodeName)
  for (const p of prims) mesh.addPrimitive(p)
  const node = doc.createNode(nodeName).setMesh(mesh)
  if (nodeName.startsWith('Wheel_')) node.setTranslation(wheels[nodeName.slice(6)].center)
  carRoot.addChild(node)
}
for (const { mesh } of parts) if (!mesh.listParents().some((p) => p.propertyType === 'Node')) mesh.dispose()

// ── 4. Optimize ──────────────────────────────────────────────────────────────
// keepUniqueNames: the caliper / tail-light clones differ from their source only by name.
await doc.transform(prune(), dedup({ keepUniqueNames: true }), weld())
const before = triangleCount()
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const [ratio, error] = ratioFor(mesh.getName(), prim.getMaterial()?.getName() ?? '')
    if (ratio < 1) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false })
  }
}
await doc.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.textureSize, cfg.textureSize], quality: 82 }),
)
const after = triangleCount()

/** [ratio, error] for a primitive: the first cfg.simplify entry whose regex matches. */
function ratioFor(meshName, matName) {
  for (const [re, r, err] of cfg.simplify) if (re.test(meshName) || re.test(matName)) return [r, err ?? cfg.simplifyError]
  return [1, 0]
}

function triangleCount() {
  let t = 0
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3
  return t
}

// ── 5. Write the full and Low-preset models ──────────────────────────────────
const outDir = resolve(cfg.outDir)
await mkdir(outDir, { recursive: true })
// The Low copy is simplified from the unquantized model, so clone before meshopt.
const low = cloneDocument(doc)
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
await io.write(`${outDir}/${cfg.id}.glb`, doc)

let lowTris = 0
for (const mesh of low.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: cfg.lowRatio, error: 0.01 })
    lowTris += prim.getIndices().getCount() / 3
  }
}
await low.transform(
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [cfg.textureSize / 2, cfg.textureSize / 2], quality: 75 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
)
await io.write(`${outDir}/${cfg.id}_low.glb`, low)

// ── 6. Report ────────────────────────────────────────────────────────────────
const b = getBounds(scene)
const r3 = (v) => v.map((n) => +n.toFixed(3))
console.log(`triangles: ${before} → ${after} (low: ${lowTris})`)
console.log(`bounds: min ${r3(b.min)} max ${r3(b.max)} → L ${(b.max[2] - b.min[2]).toFixed(2)} W ${(b.max[0] - b.min[0]).toFixed(2)} H ${(b.max[1] - b.min[1]).toFixed(2)} m`)
for (const id of ['FL', 'FR', 'RL', 'RR']) {
  const w = wheels[id]
  console.log(`Wheel_${id}: axle ${r3(w.center)} radius ${w.radius.toFixed(3)} width ${w.width.toFixed(3)}`)
}
console.log(`wheelbase ${(wheels.FL.center[2] - wheels.RL.center[2]).toFixed(3)} m, track F ${(wheels.FL.center[0] - wheels.FR.center[0]).toFixed(3)} R ${(wheels.RL.center[0] - wheels.RR.center[0]).toFixed(3)} m`)
const perMaterial = new Map()
for (const m of root.listMeshes()) {
  for (const p of m.listPrimitives()) {
    const k = p.getMaterial()?.getName() ?? '(none)'
    perMaterial.set(k, (perMaterial.get(k) ?? 0) + (p.getIndices()?.getCount() ?? 0) / 3)
  }
}
console.log('triangles by material:', [...perMaterial].map(([k, v]) => `${k} ${Math.round(v / 1000)}k`).join(', '))

// ── Geometry helpers ─────────────────────────────────────────────────────────

function multiply(a, b) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}

function indicesOf(prim) {
  const idx = prim.getIndices()
  if (idx) return idx.getArray()
  const n = prim.getAttribute('POSITION').getCount()
  return Uint32Array.from({ length: n }, (_, i) => i)
}

/** Triangle indices grouped by a key computed from each triangle's centroid. */
function groupTriangles(prim, keyOf) {
  const idx = indicesOf(prim)
  const pos = prim.getAttribute('POSITION').getArray()
  const groups = new Map()
  for (let t = 0; t < idx.length; t += 3) {
    const c = [0, 1, 2].map((a) => (pos[idx[t] * 3 + a] + pos[idx[t + 1] * 3 + a] + pos[idx[t + 2] * 3 + a]) / 3)
    const k = keyOf(c)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(t / 3)
  }
  return groups
}

/** Connected components by shared vertex position (union-find). */
function components(prim) {
  const idx = indicesOf(prim)
  const pos = prim.getAttribute('POSITION').getArray()
  // Weld by position so seams split only where geometry really separates.
  const key = new Map()
  const canon = new Int32Array(pos.length / 3)
  for (let v = 0; v < canon.length; v++) {
    const k = `${pos[v * 3].toFixed(5)},${pos[v * 3 + 1].toFixed(5)},${pos[v * 3 + 2].toFixed(5)}`
    if (!key.has(k)) key.set(k, v)
    canon[v] = key.get(k)
  }
  const parent = Int32Array.from(canon, (_, i) => i)
  const find = (x) => {
    while (parent[x] !== x) x = parent[x] = parent[parent[x]]
    return x
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(canon[idx[t]])
    const b2 = find(canon[idx[t + 1]])
    const c = find(canon[idx[t + 2]])
    parent[b2] = a
    parent[find(c)] = a
  }
  const comps = new Map()
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(canon[idx[t]])
    let comp = comps.get(r)
    if (!comp) comps.set(r, (comp = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }))
    comp.tris.push(t / 3)
    for (let k = 0; k < 3; k++) {
      const v = idx[t + k]
      for (let a = 0; a < 3; a++) {
        comp.min[a] = Math.min(comp.min[a], pos[v * 3 + a])
        comp.max[a] = Math.max(comp.max[a], pos[v * 3 + a])
      }
    }
  }
  for (const c of comps.values()) {
    c.center = c.min.map((v, a) => (v + c.max[a]) / 2)
    c.size = c.max.map((v, a) => v - c.min[a])
  }
  return comps.values()
}

/** A new primitive holding only the given triangles, with compacted vertices. */
function subset(prim, tris) {
  const idx = indicesOf(prim)
  const remap = new Map()
  const newIdx = new Uint32Array(tris.length * 3)
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k]
      if (!remap.has(v)) remap.set(v, remap.size)
      newIdx[i * 3 + k] = remap.get(v)
    }
  })
  const out = doc.createPrimitive().setMaterial(prim.getMaterial()).setMode(prim.getMode())
  for (const semantic of prim.listSemantics()) {
    const acc = prim.getAttribute(semantic)
    const size = acc.getElementSize()
    const src = acc.getArray()
    const dst = new src.constructor(remap.size * size)
    for (const [oldV, newV] of remap) for (let e = 0; e < size; e++) dst[newV * size + e] = src[oldV * size + e]
    out.setAttribute(semantic, doc.createAccessor().setType(acc.getType()).setArray(dst).setNormalized(acc.getNormalized()).setBuffer(buffer))
  }
  out.setIndices(doc.createAccessor().setType('SCALAR').setArray(newIdx).setBuffer(buffer))
  return out
}
