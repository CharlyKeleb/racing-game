// Builds the AI-rival LOD of each car from its shipped Low model:
// public/models/cars/<id>/<id>_low.glb → <id>_rival.glb.
//
// usage: node scripts/cars/build-rival-lod.mjs [id ...]   (default: every car with a _low.glb)
//
// A Low-preset race draws up to seven rivals in a ~150-draw-call, ~200k-triangle
// frame (CLAUDE.md), so a rival gets a handful of draw calls and a few thousand
// triangles. The car contract (docs/ASSET_PIPELINE.md) is kept, so rigCarModel,
// Vehicle and RivalPaint treat it like any other model:
// - Chassis keeps the paint (plain `paint`, a livery alias from LiveryDesign.ts,
//   or an old "body color") and the lamp materials Vehicle lights up, as they are.
// - Every other opaque material on the body becomes one `trim` material, its
//   colour baked into the vertices (base colour × the texture under each vertex).
// - Every see-through body material becomes one `glass` material.
// - Each wheel becomes one `wheel` primitive, baked the same way.
// - Then everything is decimated to a fixed budget.
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dequantize, meshopt, prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const CARS = resolve('public/models/cars')
/** Triangle budget per part. Wheels are small on screen; the paint carries the car's shape. */
const BUDGET = { paint: 3000, trim: 4000, glass: 300, lamp: 250, wheel: 250 }
/** Simplifier error limits (share of the part's size): tight on the paint, which carries the car's shape. */
const ERRORS = { paint: 0.01, wheel: 0.05, default: 0.03 }
/** Faces meeting at more than this keep a hard edge. */
const CREASE = (40 * Math.PI) / 180
/** Same tests as Vehicle's lamp lookup and RivalPaint, so those still find their materials. */
const LAMP = /^lights$|head ?light|tail ?light|brake ?light/i
const BODY_COLOUR = /body.?colou?r/i

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
})
const aliases = await paintAliases()


async function carsWithLow() {
  const out = []
  for (const id of (await readdir(CARS)).sort()) {
    if (await stat(`${CARS}/${id}/${id}_low.glb`).catch(() => null)) out.push(id)
  }
  return out
}

/** paintAliases per car id, read from the livery placements so the rule has one home. */
async function paintAliases() {
  const src = await readFile(resolve('src/vehicles/LiveryDesign.ts'), 'utf8')
  const out = {}
  for (const m of src.matchAll(/^\s*(\w+):\s*\{[^\n]*?paintAliases:\s*\[([^\]]*)\]/gm)) {
    out[m[1]] = [...m[2].matchAll(/'([^']*)'/g)].map((a) => a[1])
  }
  return out
}

/** Plain paint (RivalPaint colours it, dropping its maps): `paint`, `paint.*` or an old "body color". */
function isPlainPaint(name) {
  const n = name.toLowerCase()
  return n === 'paint' || n.startsWith('paint.') || BODY_COLOUR.test(name)
}

function isPaint(name, id) {
  return isPlainPaint(name) || (aliases[id] ?? []).includes(name)
}

async function build(id) {
  const doc = await io.read(`${CARS}/${id}/${id}_low.glb`)
  await doc.transform(dequantize())
  const root = doc.getRoot()
  const buffer = root.listBuffers()[0]
  const before = stats(doc)

  const trim = material(doc, 'trim', { metal: 0.25, rough: 0.5 })
  const glass = material(doc, 'glass', { metal: 0.1, rough: 0.05, alpha: 0.55, colour: [0.02, 0.025, 0.03] })
  const wheel = material(doc, 'wheel', { metal: 0.45, rough: 0.45 })
  const textures = new Map()

  /**
   * Kept materials (paint, lamps): a copy each with the same name and factors.
   * A livery keeps its texture; the rest are baked into vertex colours.
   */
  const kept = new Map()
  const liveries = new Set()
  const keep = (mat, livery = false) => {
    let own = kept.get(mat)
    if (!own) {
      own = doc.createMaterial(mat.getName())
        .setBaseColorFactor(livery ? mat.getBaseColorFactor() : [1, 1, 1, mat.getBaseColorFactor()[3]])
        .setBaseColorTexture(livery ? mat.getBaseColorTexture() : null)
        .setEmissiveFactor(mat.getEmissiveFactor())
        .setMetallicFactor(mat.getMetallicFactor())
        .setRoughnessFactor(mat.getRoughnessFactor())
        .setAlphaMode(mat.getAlphaMode())
        .setDoubleSided(mat.getDoubleSided())
      kept.set(mat, own)
    }
    return own
  }

  const done = new Set()
  for (const node of root.listNodes()) {
    const mesh = node.getMesh()
    if (!mesh || done.has(mesh)) continue
    done.add(mesh)
    const isWheel = /^Wheel_(FL|FR|RL|RR)$/.test(node.getName())
    /** Baked parts, by target material. */
    const baked = new Map()
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()
      const name = mat?.getName() ?? ''
      let target, tint = 'baked'
      if (isWheel) target = wheel
      // White where the game sets the colour: RivalPaint's team colour, Vehicle's lamp lenses.
      else if (mat && (isPlainPaint(name) || LAMP.test(name))) { target = keep(mat); tint = 'white' }
      // A texture livery (decals, sponsor art) keeps its texture and UVs: same one draw call.
      else if (mat && isPaint(name, id)) {
        const textured = !!mat.getBaseColorTexture() && !!prim.getAttribute('TEXCOORD_0')
        target = keep(mat, textured)
        if (textured) { tint = 'uv'; liveries.add(target) }
      }
      else if (mat?.getAlphaMode() === 'BLEND') { target = glass; tint = 'white' }
      else target = trim
      const list = baked.get(target) ?? []
      list.push(tint === 'uv' ? uvPart(prim) : await bakePart(prim, textures, tint === 'white'))
      baked.set(target, list)
      prim.dispose()
    }
    for (const [target, parts] of baked) {
      const name = target.getName()
      const budget = BUDGET[name] ?? (LAMP.test(name) ? BUDGET.lamp : BUDGET.paint)
      const prim = mergeParts(doc, buffer, parts, target, budget, ERRORS[name] ?? ERRORS.default, liveries.has(target))
      if (prim) mesh.addPrimitive(prim)
    }
  }
  // Only liveries sample a texture now (prune keeps some extension textures).
  const used = new Set([...liveries].map(m => m.getBaseColorTexture()))
  for (const texture of root.listTextures()) if (!used.has(texture)) texture.dispose()
  await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const out = `${CARS}/${id}/${id}_rival.glb`
  await io.write(out, doc)
  const after = stats(doc)
  const kb = Math.round((await stat(out)).size / 1024)
  console.log(`${id}: ${before.calls} calls / ${before.tris} tris → ${after.calls} calls / ${after.tris} tris (${kb} KB)`)
}

function material(doc, name, { metal, rough, alpha = 1, colour = [1, 1, 1] }) {
  const m = doc.createMaterial(name).setBaseColorFactor([...colour, alpha]).setMetallicFactor(metal).setRoughnessFactor(rough).setDoubleSided(true)
  return alpha < 1 ? m.setAlphaMode('BLEND') : m
}

/** One primitive's triangles with its colour baked per vertex (linear RGB). */
async function bakePart(prim, textures, white) {
  const mat = prim.getMaterial()
  const pos = prim.getAttribute('POSITION')
  const uv = prim.getAttribute('TEXCOORD_0')
  const count = pos.getCount()
  const factor = mat?.getBaseColorFactor() ?? [1, 1, 1, 1]
  const tex = mat?.getBaseColorTexture()
  const image = tex && uv ? await decode(tex, textures) : null
  const positions = new Float32Array(count * 3)
  const colours = new Float32Array(count * 3)
  const p = [0, 0, 0], t = [0, 0]
  for (let i = 0; i < count; i++) {
    pos.getElement(i, p)
    positions.set(p, i * 3)
    let r = factor[0], g = factor[1], b = factor[2]
    if (image) {
      uv.getElement(i, t)
      const s = sample(image, t[0], t[1])
      r *= s[0]; g *= s[1]; b *= s[2]
    }
    // Glass keeps one tint, and plain paint takes the team colour from its material.
    if (white) r = g = b = 1
    colours[i * 3] = r; colours[i * 3 + 1] = g; colours[i * 3 + 2] = b
  }
  const index = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: count }, (_, i) => i)
  return { positions, attrs: colours, index }
}

/** A livery primitive's triangles with its UVs, for a textured copy. */
function uvPart(prim) {
  const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0')
  const count = pos.getCount()
  const positions = new Float32Array(count * 3), uvs = new Float32Array(count * 2)
  const p = [0, 0, 0], t = [0, 0]
  for (let i = 0; i < count; i++) {
    pos.getElement(i, p); positions.set(p, i * 3)
    uv.getElement(i, t); uvs.set(t, i * 2)
  }
  const index = prim.getIndices()?.getArray() ?? Uint32Array.from({ length: count }, (_, i) => i)
  return { positions, attrs: uvs, index }
}

/**
 * The parts of one node going to `target` as a single primitive, decimated to
 * `budget` triangles and given creased normals. Baked parts carry a colour per
 * vertex and are welded by position alone, so UV and hard-edge seams don't stop
 * the simplifier. A livery carries UVs instead, and its UV seams stay.
 */
function mergeParts(doc, buffer, parts, target, budget, error, textured) {
  const stride = textured ? 2 : 3
  const vertices = parts.reduce((s, p) => s + p.positions.length / 3, 0)
  const indices = parts.reduce((s, p) => s + p.index.length, 0)
  const positions = new Float32Array(vertices * 3), attrs = new Float32Array(vertices * stride)
  const index = new Uint32Array(indices)
  let v = 0, k = 0
  for (const part of parts) {
    positions.set(part.positions, v * 3); attrs.set(part.attrs, v * stride)
    for (let i = 0; i < part.index.length; i++) index[k++] = part.index[i] + v
    v += part.positions.length / 3
  }
  const welded = weld(positions, attrs, stride, index, textured)
  let tris = welded.index
  if (tris.length / 3 > budget) {
    const weights = textured ? [0.5, 0.5] : [0.6, 0.6, 0.6]
    ;[tris] = MeshoptSimplifier.simplifyWithAttributes(welded.index, welded.positions, 3, welded.attrs, stride, weights, null, budget * 3, error, textured ? ['Prune', 'Permissive'] : ['Prune'])
  }
  if (!tris.length) return null // a tiny part (a decal) can simplify away
  const creased = creasedNormals(tris, welded.positions, welded.attrs, stride)
  const accessor = (array, type) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer)
  return doc.createPrimitive()
    .setMaterial(target)
    .setIndices(accessor(creased.index, 'SCALAR'))
    .setAttribute('POSITION', accessor(creased.positions, 'VEC3'))
    .setAttribute('NORMAL', accessor(creased.normals, 'VEC3'))
    .setAttribute(textured ? 'TEXCOORD_0' : 'COLOR_0', accessor(creased.attrs, textured ? 'VEC2' : 'VEC3'))
}

/**
 * Vertices at the same spot (to 0.1 mm) become one, their attributes averaged;
 * with `exact`, only where the attributes match too (UV seams stay).
 */
function weld(positions, attrs, stride, index, exact) {
  const ids = new Map()
  const remap = new Uint32Array(positions.length / 3)
  const outP = [], sum = [], counts = []
  for (let i = 0; i < remap.length; i++) {
    let key = `${Math.round(positions[i * 3] * 1e4)},${Math.round(positions[i * 3 + 1] * 1e4)},${Math.round(positions[i * 3 + 2] * 1e4)}`
    if (exact) for (let c = 0; c < stride; c++) key += `,${Math.round(attrs[i * stride + c] * 1e4)}`
    let id = ids.get(key)
    if (id === undefined) {
      id = counts.length
      ids.set(key, id)
      outP.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      for (let c = 0; c < stride; c++) sum.push(0)
      counts.push(0)
    }
    for (let c = 0; c < stride; c++) sum[id * stride + c] += attrs[i * stride + c]
    counts[id]++
    remap[i] = id
  }
  const outA = new Float32Array(sum.length)
  for (let i = 0; i < counts.length; i++) for (let c = 0; c < stride; c++) outA[i * stride + c] = sum[i * stride + c] / counts[i]
  const out = []
  for (let i = 0; i < index.length; i += 3) {
    const a = remap[index[i]], b = remap[index[i + 1]], c = remap[index[i + 2]]
    if (a !== b && b !== c && a !== c) out.push(a, b, c) // welding can collapse slivers
  }
  return { positions: new Float32Array(outP), attrs: outA, index: Uint32Array.from(out) }
}

/**
 * Per-corner normals smoothed only across faces within CREASE of each other,
 * so panel edges stay sharp, then one vertex per distinct position + normal.
 */
function creasedNormals(index, positions, attrs, stride) {
  const faces = index.length / 3
  const faceNormal = new Float32Array(faces * 3)
  const faceArea = new Float32Array(faces)
  const incident = new Map() // vertex → faces
  for (let f = 0; f < faces; f++) {
    const a = index[f * 3] * 3, b = index[f * 3 + 1] * 3, c = index[f * 3 + 2] * 3
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx
    const l = Math.hypot(x, y, z) || 1
    faceNormal[f * 3] = x / l; faceNormal[f * 3 + 1] = y / l; faceNormal[f * 3 + 2] = z / l
    faceArea[f] = l
    for (let k = 0; k < 3; k++) {
      const v = index[f * 3 + k]
      const list = incident.get(v)
      if (list) list.push(f)
      else incident.set(v, [f])
    }
  }
  const cos = Math.cos(CREASE)
  const ids = new Map()
  const outP = [], outN = [], outA = [], outIndex = new Uint32Array(index.length)
  for (let f = 0; f < faces; f++) {
    for (let k = 0; k < 3; k++) {
      const v = index[f * 3 + k]
      let nx = 0, ny = 0, nz = 0
      for (const g of incident.get(v)) {
        const d = faceNormal[f * 3] * faceNormal[g * 3] + faceNormal[f * 3 + 1] * faceNormal[g * 3 + 1] + faceNormal[f * 3 + 2] * faceNormal[g * 3 + 2]
        // Double-sided parts: a face and its back-to-back twin shade alike.
        if (Math.abs(d) < cos) continue
        const w = faceArea[g] * Math.sign(d)
        nx += faceNormal[g * 3] * w; ny += faceNormal[g * 3 + 1] * w; nz += faceNormal[g * 3 + 2] * w
      }
      const l = Math.hypot(nx, ny, nz) || 1
      nx /= l; ny /= l; nz /= l
      const key = `${v},${Math.round(nx * 64)},${Math.round(ny * 64)},${Math.round(nz * 64)}`
      let id = ids.get(key)
      if (id === undefined) {
        id = ids.size
        ids.set(key, id)
        outP.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2])
        outN.push(nx, ny, nz)
        for (let c = 0; c < stride; c++) outA.push(attrs[v * stride + c])
      }
      outIndex[f * 3 + k] = id
    }
  }
  return { index: outIndex, positions: new Float32Array(outP), normals: new Float32Array(outN), attrs: new Float32Array(outA) }
}

/** A base-colour texture as linear RGB floats, decoded once per texture. */
async function decode(texture, cache) {
  let image = cache.get(texture)
  if (!image) {
    // Small is plenty: one colour per vertex, and averaging hides texel noise.
    const { data, info } = await sharp(Buffer.from(texture.getImage())).resize(128, 128, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const lin = new Float32Array(data.length)
    for (let i = 0; i < data.length; i++) {
      const c = data[i] / 255
      lin[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    image = { data: lin, width: info.width, height: info.height }
    cache.set(texture, image)
  }
  return image
}

const _s = [0, 0, 0]
function sample(image, u, v) {
  const wrap = (x) => x - Math.floor(x)
  const x = Math.min(image.width - 1, Math.floor(wrap(u) * image.width))
  const y = Math.min(image.height - 1, Math.floor(wrap(v) * image.height))
  const o = (y * image.width + x) * 3
  _s[0] = image.data[o]; _s[1] = image.data[o + 1]; _s[2] = image.data[o + 2]
  return _s
}

function triangles(prim) {
  return (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3
}

/** Primitives (draw calls in three.js) and triangles. */
function stats(doc) {
  let calls = 0, tris = 0
  for (const node of doc.getRoot().listNodes()) {
    for (const p of node.getMesh()?.listPrimitives() ?? []) { calls++; tris += triangles(p) }
  }
  return { calls, tris }
}

const ids = process.argv.slice(2)
for (const id of ids.length ? ids : await carsWithLow()) await build(id)
