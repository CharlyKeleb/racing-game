// Offline track pipeline: one heavy Sketchfab/Blender GLB → a streamable,
// mobile-friendly track package.
//
//   node scripts/track/build-track.mjs scripts/track/nurburgring.config.mjs
//
// Output (public/models/tracks/<id>/):
//   track.json            manifest: chunks, bounds, spawn, checkpoints
//   materials_high.glb    every material + WebP textures (≤1024)  ┐ loaded once,
//   materials_low.glb     same, textures ≤256 for low-end mobile  ┘ shared by all chunks
//   backdrop.glb          simplified terrain (always loaded; only when the config has a terrain layer)
//   collision.glb         simplified drivable + barrier + terrain mesh (positions only)
//   chunks/<i>_<j>_lod0.glb / _lod1.glb   geometry-only grid cells, meshopt-compressed
//
// Chunks carry material *stubs* (name only); the runtime swaps in the shared
// library material by name, so textures are decoded and uploaded exactly once.
import { Document, Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureTransform } from '@gltf-transform/extensions'
import { meshopt, textureCompress } from '@gltf-transform/functions'
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'
import { traceCenterline } from './centerline.mjs'

const configPath = process.argv[2]
if (!configPath) throw new Error('usage: build-track.mjs <config.mjs>')
const cfg = (await import(pathToFileURL(path.resolve(configPath)).href)).default

await MeshoptSimplifier.ready
await MeshoptEncoder.ready
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

// ── 1. Read + bake world transforms ─────────────────────────────────────────
log('reading', cfg.source)
const src = await io.read(cfg.source)
const layerOf = (mat) => cfg.layers.find(([re]) => re.test(mat))[1]

// cfg.scale: uniform factor for sources modelled at the wrong scale (Sketchfab
// "City" is a ~15 × 24 unit miniature). Every coordinate in the config is in
// scaled metres.
const scale = cfg.scale ?? 1
/** @type {{mat:string, layer:string, pos:Float32Array, nrm:Float32Array|null, uv:Float32Array|null, idx:Uint32Array}[]} */
const prims = []
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMode() !== 4) continue // TRIANGLES only
    const mat = prim.getMaterial()?.getName() ?? 'default'
    const layer = layerOf(mat)
    if (layer === 'drop') continue
    const p = prim.getAttribute('POSITION').getArray()
    const n = prim.getAttribute('NORMAL')?.getArray()
    const uvAcc = prim.getAttribute('TEXCOORD_0')
    const count = p.length / 3
    const pos = new Float32Array(count * 3)
    const nrm = n ? new Float32Array(count * 3) : null
    for (let i = 0; i < count; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
      pos[i * 3] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * scale
      pos[i * 3 + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * scale
      pos[i * 3 + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * scale
      if (n) {
        const a = n[i * 3], b = n[i * 3 + 1], c = n[i * 3 + 2]
        const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c
        const l = Math.hypot(nx, ny, nz) || 1
        nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l
      }
    }
    const uv = uvAcc ? Float32Array.from(uvAcc.getArray()) : null
    const idxAcc = prim.getIndices()
    const idx = idxAcc ? Uint32Array.from(idxAcc.getArray()) : Uint32Array.from({ length: count }, (_, i) => i)
    prims.push({ mat, layer, pos, nrm, uv, idx, srcMaterial: prim.getMaterial() })
  }
}
log(`${prims.length} primitives, ${prims.reduce((s, p) => s + p.idx.length / 3, 0).toLocaleString()} tris`)

// ── 2. Locate the start line and verify checkpoints sit on the road ────────
function heightAt(x, z, layers, matRe = null) {
  let best = null
  for (const pr of prims) {
    if (!layers.includes(pr.layer)) continue
    if (matRe && !matRe.test(pr.mat)) continue
    const { pos, idx } = pr
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      const ax = pos[a], az = pos[a + 2], bx = pos[b], bz = pos[b + 2], cx = pos[c], cz = pos[c + 2]
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (d === 0) continue
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d
      const w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d
      const w2 = 1 - w0 - w1
      if (w0 < 0 || w1 < 0 || w2 < 0) continue
      const y = w0 * pos[a + 1] + w1 * pos[b + 1] + w2 * pos[c + 1]
      if (!best || y > best.y) best = { y, mat: pr.mat }
    }
  }
  return best
}

/** Hand-placed gates are read off a map, so snap each to the nearest racing asphalt within 30 m. */
function snapToRoad(x, z) {
  for (let r = 0; r <= 30; r += 1.5) {
    const steps = r === 0 ? 1 : Math.ceil((2 * Math.PI * r) / 1.5)
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2
      const hit = heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r, ['road'], cfg.gateSurface ?? /^asph/)
      if (hit) return { ...hit, at: [x + Math.cos(a) * r, z + Math.sin(a) * r], moved: r }
    }
  }
  return null
}

const gates = cfg.checkpoints.map((cp, i) => {
  const hit = snapToRoad(cp.at[0], cp.at[1])
  if (!hit) throw new Error(`checkpoint ${i} at ${cp.at} is not within 30 m of asphalt — fix the config`)
  log(`checkpoint ${i} on ${hit.mat} y=${hit.y.toFixed(2)}${hit.moved ? ` (snapped ${hit.moved} m)` : ''}`)
  return { ...cp, at: hit.at, y: hit.y }
})
if (process.env.GATES_ONLY) {
  await fs.writeFile('.cache/gates.json', JSON.stringify(gates.map((g) => ({ at: g.at, dir: g.dir }))))
  process.exit(0)
}
// Centreline for the minimap and in-world direction chevrons. Via points
// (cfg.lineVia[gateIndex]) force the route where service roads would shortcut.
const lineWaypoints = gates.flatMap((g, i) => [g.at, ...(cfg.lineVia?.[i] ?? [])])
const line = traceCenterline(prims, cfg.lineSurface, lineWaypoints, { spacing: cfg.lineSpacing ?? 4 })
log(`centreline ${line.points.length} points, ${(line.length / 1000).toFixed(2)} km`)
// Hand-placed gates are approximate (gate 0 originally landed in the pit lane).
// Snap each onto the traced centreline and take its direction from the line, so
// gates — and the spawn behind gate 0 — sit mid-track and face exactly along it.
for (const [gi, g] of gates.entries()) {
  const pts = line.points
  let best = 0
  for (let i = 1; i < pts.length; i++) {
    if (Math.hypot(pts[i][0] - g.at[0], pts[i][2] - g.at[1]) < Math.hypot(pts[best][0] - g.at[0], pts[best][2] - g.at[1])) best = i
  }
  const p = pts[best], a = pts[(best - 2 + pts.length) % pts.length], b = pts[(best + 2) % pts.length]
  const moved = Math.hypot(p[0] - g.at[0], p[2] - g.at[1])
  const dir = [b[0] - a[0], b[2] - a[2]]
  const dot = dir[0] * g.dir[0] + dir[1] * g.dir[1]
  if (dot <= 0) throw new Error(`gate ${gi}: configured direction disagrees with the centreline — the loop runs backwards?`)
  g.at = [p[0], p[2]]
  g.y = p[1]
  g.dir = dir
  log(`gate ${gi} → centreline (moved ${moved.toFixed(1)} m)`)
}
if (process.env.LINE_ONLY) {
  await fs.writeFile('.cache/line.json', JSON.stringify(line.points.map(([x, , z]) => [x, z])))
  await fs.writeFile('.cache/gates.json', JSON.stringify(gates.map((g) => ({ at: g.at, dir: g.dir }))))
  process.exit(0)
}

// cfg.origin pins the world origin so a rebuild doesn't shift every chunk (and
// re-upload them all) when gate snapping moves gate 0 by a few metres.
const origin = cfg.origin ?? [gates[0].at[0], gates[0].y, gates[0].at[1]]
log('origin (start line)', origin.map((v) => v.toFixed(2)))
for (const pr of prims)
  for (let i = 0; i < pr.pos.length; i += 3) {
    pr.pos[i] -= origin[0]; pr.pos[i + 1] -= origin[1]; pr.pos[i + 2] -= origin[2]
  }

// ── 3. Geometry helpers ─────────────────────────────────────────────────────
/** Builds a compact indexed mesh from (prim, triangle-index-list) parts. */
function gather(parts, withAttributes = true) {
  let vCount = 0, iCount = 0
  const remaps = parts.map(({ pr, tris }) => {
    const map = new Int32Array(pr.pos.length / 3).fill(-1)
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = pr.idx[t * 3 + k]
      if (map[v] < 0) map[v] = vCount++
    }
    iCount += tris.length * 3
    return map
  })
  const pos = new Float32Array(vCount * 3)
  const anyNrm = withAttributes && parts.some((p) => p.pr.nrm)
  const anyUv = withAttributes && parts.some((p) => p.pr.uv)
  const nrm = anyNrm ? new Float32Array(vCount * 3) : null
  const uv = anyUv ? new Float32Array(vCount * 2) : null
  const idx = new Uint32Array(iCount)
  const lock = new Uint8Array(vCount)
  let o = 0
  parts.forEach(({ pr, tris }, pi) => {
    const map = remaps[pi]
    for (let v = 0; v < map.length; v++) {
      const d = map[v]
      if (d < 0) continue
      pos.set(pr.pos.subarray(v * 3, v * 3 + 3), d * 3)
      if (pr.border) lock[d] = pr.border[v]
      if (nrm) nrm.set(pr.nrm ? pr.nrm.subarray(v * 3, v * 3 + 3) : [0, 1, 0], d * 3)
      if (uv && pr.uv) uv.set(pr.uv.subarray(v * 2, v * 2 + 2), d * 2)
    }
    for (const t of tris) for (let k = 0; k < 3; k++) idx[o++] = map[pr.idx[t * 3 + k]]
  })
  return { pos, nrm, uv, idx, lock }
}

/**
 * Merges vertices that share a position (and, for 'posnrm', a normal) but were
 * split by per-face UVs. Sketchfab exports guardrails/poles as near triangle
 * soup, which no simplifier can reduce until it is welded. UVs of merged
 * vertices are taken from the first one — fine on uniform metal/concrete, so
 * text-bearing materials (signs, sponsors) are excluded via cfg.keepUvs.
 */
function weld(g, mode) {
  if (mode === 'none') return g
  const n = g.pos.length / 3
  const map = new Map()
  const remap = new Uint32Array(n)
  let m = 0
  for (let v = 0; v < n; v++) {
    let key = `${Math.round(g.pos[v * 3] * 1000)},${Math.round(g.pos[v * 3 + 1] * 1000)},${Math.round(g.pos[v * 3 + 2] * 1000)}`
    if (mode === 'posnrm' && g.nrm) key += `|${Math.round(g.nrm[v * 3] * 12)},${Math.round(g.nrm[v * 3 + 1] * 12)},${Math.round(g.nrm[v * 3 + 2] * 12)}`
    let d = map.get(key)
    if (d === undefined) map.set(key, (d = m++))
    remap[v] = d
  }
  const out = { pos: new Float32Array(m * 3), nrm: g.nrm && new Float32Array(m * 3), uv: g.uv && new Float32Array(m * 2), idx: new Uint32Array(g.idx.length), lock: new Uint8Array(m) }
  for (let v = n - 1; v >= 0; v--) {
    const d = remap[v]
    out.pos.set(g.pos.subarray(v * 3, v * 3 + 3), d * 3)
    if (out.nrm) out.nrm.set(g.nrm.subarray(v * 3, v * 3 + 3), d * 3)
    if (out.uv) out.uv.set(g.uv.subarray(v * 2, v * 2 + 2), d * 2)
    out.lock[d] |= g.lock[v]
  }
  for (let i = 0; i < g.idx.length; i++) out.idx[i] = remap[g.idx[i]]
  return out
}

/** Area-weighted smooth normals, for position-welded far LODs. */
function recomputeNormals(g) {
  const nrm = new Float32Array(g.pos.length)
  const p = g.pos
  for (let t = 0; t < g.idx.length; t += 3) {
    const a = g.idx[t] * 3, b = g.idx[t + 1] * 3, c = g.idx[t + 2] * 3
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const o of [a, b, c]) { nrm[o] += nx; nrm[o + 1] += ny; nrm[o + 2] += nz }
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l
  }
  return { ...g, nrm }
}

/** Drops vertices no index references. */
function compact(g) {
  const map = new Int32Array(g.pos.length / 3).fill(-1)
  let n = 0
  for (const v of g.idx) if (map[v] < 0) map[v] = n++
  const out = { pos: new Float32Array(n * 3), nrm: g.nrm && new Float32Array(n * 3), uv: g.uv && new Float32Array(n * 2), idx: new Uint32Array(g.idx.length), lock: new Uint8Array(n) }
  for (let v = 0; v < map.length; v++) {
    const d = map[v]
    if (d < 0) continue
    out.pos.set(g.pos.subarray(v * 3, v * 3 + 3), d * 3)
    out.lock[d] = g.lock[v]
    if (out.nrm) out.nrm.set(g.nrm.subarray(v * 3, v * 3 + 3), d * 3)
    if (out.uv) out.uv.set(g.uv.subarray(v * 2, v * 2 + 2), d * 2)
  }
  for (let i = 0; i < g.idx.length; i++) out.idx[i] = map[g.idx[i]]
  return out
}

/**
 * Absolute-error simplification. Only vertices shared with a neighbouring chunk
 * are locked (no cracks between chunks); open edges inside a chunk — guardrail
 * strips, road ribbons — are free to simplify, which plain LockBorder forbids.
 * UVs are weighted in so tiled textures don't smear.
 */
function simplify(g, error, { prune = false } = {}) {
  if (error == null || g.idx.length < 3 * 16) return g
  const flags = ['ErrorAbsolute', ...(prune ? ['Prune'] : [])]
  const attrs = g.uv ?? new Float32Array(0)
  const [idx] = MeshoptSimplifier.simplifyWithAttributes(g.idx, g.pos, 3, attrs, g.uv ? 2 : 0, g.uv ? [0.05, 0.05] : [], g.lock, 0, error, flags)
  if (idx.length === 0) return null
  return compact({ ...g, idx })
}

/**
 * Collision only: a strip hanging off the road's open edges, `width` m out
 * and sloping `drop` m down, wherever `cover` (the chunk's road and run-off)
 * has no floor just outside. Where the source model has a hole between the
 * asphalt and the verge (the Nürburgring has a 1.4 m one at the last chicane)
 * it catches the wheels and the car instead of letting them fall through.
 */
/** XZ coverage of some meshes on a 0.25 m grid: has(x, z) is true where a cell centre lies in one of their triangles. */
function floorCover(meshes) {
  const C = 0.25
  const cells = new Set()
  for (const g of meshes) {
    for (let t = 0; t < g.idx.length; t += 3) {
      const a = g.idx[t] * 3, b = g.idx[t + 1] * 3, c = g.idx[t + 2] * 3
      const x0 = Math.floor(Math.min(g.pos[a], g.pos[b], g.pos[c]) / C), x1 = Math.floor(Math.max(g.pos[a], g.pos[b], g.pos[c]) / C)
      const z0 = Math.floor(Math.min(g.pos[a + 2], g.pos[b + 2], g.pos[c + 2]) / C), z1 = Math.floor(Math.max(g.pos[a + 2], g.pos[b + 2], g.pos[c + 2]) / C)
      const d = (g.pos[b] - g.pos[a]) * (g.pos[c + 2] - g.pos[a + 2]) - (g.pos[b + 2] - g.pos[a + 2]) * (g.pos[c] - g.pos[a])
      for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
        if (Math.abs(d) < 1e-9) continue
        const x = (i + 0.5) * C, z = (j + 0.5) * C
        const u = ((x - g.pos[a]) * (g.pos[c + 2] - g.pos[a + 2]) - (z - g.pos[a + 2]) * (g.pos[c] - g.pos[a])) / d
        const v = ((g.pos[b] - g.pos[a]) * (z - g.pos[a + 2]) - (g.pos[b + 2] - g.pos[a + 2]) * (x - g.pos[a])) / d
        if (u >= 0 && v >= 0 && u + v <= 1) cells.add(i * 1000003 + j)
      }
    }
  }
  return { has: (x, z) => cells.has(Math.floor(x / C) * 1000003 + Math.floor(z / C)) }
}

function skirt(g, width, drop, cover) {
  const edges = new Map() // "a,b" (a<b) → [count, third vertex]
  const tris = g.idx.length / 3
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const a = g.idx[t * 3 + k], b = g.idx[t * 3 + ((k + 1) % 3)], c = g.idx[t * 3 + ((k + 2) % 3)]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const e = edges.get(key)
      if (e) e[0]++
      else edges.set(key, [1, a, b, c])
    }
  }
  const pos = Array.from(g.pos), idx = Array.from(g.idx)
  let n = g.pos.length / 3
  for (const [count, a, b, c] of edges.values()) {
    if (count !== 1) continue
    const ax = g.pos[a * 3], az = g.pos[a * 3 + 2], bx = g.pos[b * 3], bz = g.pos[b * 3 + 2]
    let nx = -(bz - az), nz = bx - ax
    const l = Math.hypot(nx, nz)
    if (l < 1e-4) continue
    nx /= l; nz /= l
    // Outward: away from the triangle's third vertex.
    if ((g.pos[c * 3] - ax) * nx + (g.pos[c * 3 + 2] - az) * nz > 0) { nx = -nx; nz = -nz }
    // Floor (run-off, more road) just outside: nothing to bridge, no skirt.
    const mx = (ax + bx) / 2, mz = (az + bz) / 2
    if (cover && cover.has(mx + nx * 0.5, mz + nz * 0.5) && cover.has(mx + nx * 1, mz + nz * 1)) continue
    pos.push(ax + nx * width, g.pos[a * 3 + 1] - drop, az + nz * width, bx + nx * width, g.pos[b * 3 + 1] - drop, bz + nz * width)
    idx.push(a, b, n, b, n + 1, n)
    n += 2
  }
  return { ...g, pos: Float32Array.from(pos), idx: Uint32Array.from(idx), lock: new Uint8Array(n) }
}

/** Connected components (by shared vertex) — one per tree card cluster. */
function components(pr) {
  const parent = new Int32Array(pr.pos.length / 3).map((_, i) => i)
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a }
  for (let t = 0; t < pr.idx.length; t += 3) {
    const a = find(pr.idx[t]), b = find(pr.idx[t + 1]), c = find(pr.idx[t + 2])
    parent[b] = a; parent[c] = a
  }
  return (t) => find(pr.idx[t * 3])
}
const hash01 = (n) => { let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296 }

// ── Far-LOD colour baking ───────────────────────────────────────────────────
/** Material name the runtime maps to its shared vertex-colour material. */
const VERTEX_COLOR_MATERIAL = '__vertex_color'
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const rawCache = new Map()
/** Linear RGB average of a material's base colour texture × its authored factor. */
async function rawAverageColor(matName) {
  if (rawCache.has(matName)) return rawCache.get(matName)
  const m = src.getRoot().listMaterials().find((x) => x.getName() === matName)
  const f = m?.getBaseColorFactor() ?? [1, 1, 1, 1]
  let rgb = [0.6, 0.6, 0.6]
  const img = m?.getBaseColorTexture()?.getImage()
  if (img) {
    const { channels } = await sharp(Buffer.from(img)).stats()
    rgb = channels.slice(0, 3).map((c) => srgbToLinear(c.mean / 255))
  }
  const color = rgb.map((c, i) => c * f[i])
  rawCache.set(matName, color)
  return color
}

/**
 * Colour correction per material (cfg.albedo): scales a material so its average
 * linear luminance hits a real-world target, times a hue. The source asphalt is
 * a flat mid grey (~42 % sRGB) that reads as concrete in sunlight; real asphalt
 * is ~25–30 % sRGB. Normalising also makes old/new resurfaced patches match.
 */
async function albedoTint(matName) {
  const rule = cfg.albedo?.find(([re]) => re.test(matName))
  if (!rule) return [1, 1, 1]
  const [, target, hue = [1, 1, 1]] = rule
  const [r, g, b] = await rawAverageColor(matName)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return hue.map((h) => (h * target) / Math.max(lum, 1e-4))
}

/** Linear RGB average as shipped (after albedo correction) — the far-LOD vertex colour. */
async function averageColor(matName) {
  const raw = await rawAverageColor(matName)
  const tint = await albedoTint(matName)
  return raw.map((c, i) => c * tint[i])
}

async function tintedFactor(m) {
  const f = m.getBaseColorFactor()
  const t = await albedoTint(m.getName())
  return [f[0] * t[0], f[1] * t[1], f[2] * t[2], f[3]]
}

/** Concatenates geometries into one, painting each with its colour. */
function mergeColored(list) {
  const vCount = list.reduce((n, { g }) => n + g.pos.length / 3, 0)
  const iCount = list.reduce((n, { g }) => n + g.idx.length, 0)
  const out = { pos: new Float32Array(vCount * 3), nrm: new Float32Array(vCount * 3), color: new Float32Array(vCount * 3), idx: new Uint32Array(iCount), uv: null }
  let v = 0, o = 0
  for (const { g, color } of list) {
    const n = g.pos.length / 3
    out.pos.set(g.pos, v * 3)
    if (g.nrm) out.nrm.set(g.nrm, v * 3)
    for (let i = 0; i < n; i++) out.color.set(color, (v + i) * 3)
    for (let i = 0; i < g.idx.length; i++) out.idx[o++] = g.idx[i] + v
    v += n
  }
  return out
}

// ── 4. Bucket triangles into the streaming grid ────────────────────────────
const S = cfg.chunkSize
// Keep scenery only near the circuit: the far Eifel forests are horizon dressing
// the terrain texture already shows, and cost ~1M triangles of alpha cards.
const keepBox = (() => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  // cfg.cropTo: material regex for the box (default: every road material).
  // Marina Bay's pavements are 'road' for collision but run for kilometres
  // through the city, so it crops to the circuit asphalt instead.
  const circuit = (pr) => (cfg.cropTo ? cfg.cropTo.test(pr.mat) : pr.layer === 'road')
  for (const pr of prims) if (circuit(pr)) for (let i = 0; i < pr.pos.length; i += 3) {
    x0 = Math.min(x0, pr.pos[i]); x1 = Math.max(x1, pr.pos[i]); z0 = Math.min(z0, pr.pos[i + 2]); z1 = Math.max(z1, pr.pos[i + 2])
  }
  const m = cfg.sceneryMargin
  return [x0 - m, z0 - m, x1 + m, z1 + m]
})()
const cells = new Map() // "i_j" → Map(mat → { layer, lod0: parts[], lod1: parts[] })
let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity
for (const pr of prims) {
  if (pr.layer === 'terrain') continue
  const veg = pr.layer === 'veg'
  const comp = veg ? components(pr) : null
  const keep = veg ? cfg.vegKeep[pr.mat] ?? cfg.vegKeep.default : null
  const byCell = new Map()
  const triCount = pr.idx.length / 3
  const vCell = new Int32Array(pr.pos.length / 3).fill(-0x7fffffff)
  pr.border = new Uint8Array(pr.pos.length / 3)
  for (let t = 0; t < triCount; t++) {
    const a = pr.idx[t * 3] * 3, b = pr.idx[t * 3 + 1] * 3, c = pr.idx[t * 3 + 2] * 3
    let cx = (pr.pos[a] + pr.pos[b] + pr.pos[c]) / 3
    let cz = (pr.pos[a + 2] + pr.pos[b + 2] + pr.pos[c + 2]) / 3
    let lodMask = 3 // bit0 = lod0, bit1 = lod1
    if (veg) {
      // Thin whole cards, and bucket a card by its first vertex so it never splits.
      const r = hash01(comp(t))
      if (r >= keep[0]) continue
      lodMask = r < keep[1] ? 3 : 1
      cx = pr.pos[a]; cz = pr.pos[a + 2]
    }
    if (cx < keepBox[0] || cz < keepBox[1] || cx > keepBox[2] || cz > keepBox[3]) continue
    const i = Math.floor(cx / S), j = Math.floor(cz / S)
    const cellId = i * 100003 + j
    for (let k = 0; k < 3; k++) {
      const v = pr.idx[t * 3 + k]
      if (vCell[v] === -0x7fffffff) vCell[v] = cellId
      else if (vCell[v] !== cellId) pr.border[v] = 1
    }
    const key = `${i}_${j}`
    let e = byCell.get(key)
    if (!e) byCell.set(key, (e = { i, j, lod0: [], lod1: [] }))
    if (lodMask & 1) e.lod0.push(t)
    if (lodMask & 2) e.lod1.push(t)
  }
  for (const [key, e] of byCell) {
    minI = Math.min(minI, e.i); maxI = Math.max(maxI, e.i); minJ = Math.min(minJ, e.j); maxJ = Math.max(maxJ, e.j)
    let cell = cells.get(key)
    if (!cell) cells.set(key, (cell = { i: e.i, j: e.j, groups: new Map() }))
    let g = cell.groups.get(pr.mat)
    if (!g) cell.groups.set(pr.mat, (g = { layer: pr.layer, lod0: [], lod1: [] }))
    if (e.lod0.length) g.lod0.push({ pr, tris: e.lod0 })
    if (e.lod1.length) g.lod1.push({ pr, tris: e.lod1 })
  }
}
log(`${cells.size} chunks over grid i[${minI},${maxI}] j[${minJ},${maxJ}]`)

// ── 5. Writers ─────────────────────────────────────────────────────────────
const outDir = path.resolve(cfg.out)
await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(path.join(outDir, 'chunks'), { recursive: true })

function newDoc() {
  const doc = new Document()
  doc.createBuffer()
  doc.createScene('scene')
  return doc
}

/** Adds a mesh node; `mat` is a name-only stub the runtime resolves. */
function addMesh(doc, name, g, mat, stubs) {
  const buf = doc.getRoot().listBuffers()[0]
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(g.pos).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(g.pos.length / 3 <= 65535 ? Uint16Array.from(g.idx) : g.idx).setBuffer(buf))
  if (g.nrm) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(g.nrm).setBuffer(buf))
  if (g.uv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(g.uv).setBuffer(buf))
  if (g.color) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(g.color).setBuffer(buf))
  if (mat) {
    let stub = stubs.get(mat)
    if (!stub) stubs.set(mat, (stub = doc.createMaterial(mat)))
    prim.setMaterial(stub)
  }
  const mesh = doc.createMesh(name).addPrimitive(prim)
  doc.getRoot().listScenes()[0].addChild(doc.createNode(name).setMesh(mesh))
}

async function writeDoc(doc, rel, quantizePosition = 14) {
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition }))
  const bytes = await io.writeBinary(doc)
  await fs.writeFile(path.join(outDir, rel), bytes)
  return bytes.byteLength
}

const bounds = (pos) => {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k])
  }
  return { min, max }
}
const round = (v) => Math.round(v * 100) / 100

/**
 * Some exporters flag every material BLEND. A blended material whose texture
 * has no transparent pixels is really opaque: render it so (no sorting, early-z).
 */
const opaqueCache = new Map()
async function textureIsOpaque(tex) {
  if (!tex) return true
  if (!opaqueCache.has(tex)) {
    const { channels } = await sharp(Buffer.from(tex.getImage())).stats()
    opaqueCache.set(tex, channels.length < 4 || channels[3].min >= 250)
  }
  return opaqueCache.get(tex)
}

const srcMaterialByName = new Map(src.getRoot().listMaterials().map((m) => [m.getName(), m]))

/**
 * cfg.mergeSmallProps (tris): in LOD0, prop meshes smaller than this in a chunk
 * (signs, poles, trims) are merged into one vertex-coloured draw call, like
 * LOD1. Dense city scenery has ~50 prop materials per chunk, most of them tiny,
 * and each costs a draw call. Props with any transparency keep their texture.
 */
async function mergeAsSmallProp(mat, layer, tris) {
  if (!cfg.mergeSmallProps || layer !== 'prop' || tris >= cfg.mergeSmallProps) return false
  return textureIsOpaque(srcMaterialByName.get(mat)?.getBaseColorTexture())
}

// ── 6. Chunks (LOD0 + LOD1) + per-chunk collision ──────────────────────────
const manifestChunks = []
const collisionParts = [] // { name, g }
const usedMaterials = new Set()
const layerTris = {}
const matTris = {}
let totals = { lod0: 0, lod1: 0, bytes0: 0, bytes1: 0, col: 0 }

for (const cell of [...cells.values()].sort((a, b) => a.i - b.i || a.j - b.j)) {
  const id = `${cell.i}_${cell.j}`
  const entry = { id, i: cell.i, j: cell.j, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], lods: [] }
  const colParts = []
  for (const lod of [0, 1]) {
    const doc = newDoc()
    const stubs = new Map()
    const merged = []
    const small = []
    let tris = 0
    for (const [mat, grp] of cell.groups) {
      const parts = lod === 0 ? grp.lod0 : grp.lod1
      if (!parts.length) continue
      let g = gather(parts)
      if (grp.layer !== 'veg') {
        const exact = cfg.keepUvs.test(mat)
        const mode = exact ? 'none' : lod === 0 ? cfg.weld[grp.layer] ?? 'none' : 'pos'
        g = simplify(weld(g, mode), cfg.lod[grp.layer][lod], { prune: lod === 1 && (grp.layer === 'prop' || grp.layer === 'barrier') })
        if (g && mode === 'pos') g = recomputeNormals(g)
      }
      if (!g) continue
      if (lod === 0) {
        const b = bounds(g.pos)
        for (let k = 0; k < 3; k++) { entry.min[k] = Math.min(entry.min[k], b.min[k]); entry.max[k] = Math.max(entry.max[k], b.max[k]) }
        if (['road', 'ground', 'barrier'].includes(grp.layer)) colParts.push({ layer: grp.layer, parts: grp.lod0 })
        else {
          // Painted-on ground (logos, ads) that has no road or grass under it:
          // without collision it's a hole in the floor (see cfg.collide).
          const extra = cfg.collide?.find(([re]) => re.test(mat))
          if (extra) colParts.push({ layer: extra[1], parts: grp.lod0 })
        }
      }
      layerTris[`${grp.layer}${lod}`] = (layerTris[`${grp.layer}${lod}`] ?? 0) + g.idx.length / 3
      if (lod === 0) matTris[mat] = (matTris[mat] ?? 0) + g.idx.length / 3
      if (lod === 1 && grp.layer !== 'veg') {
        if (grp.layer !== 'decal') merged.push({ g, color: await averageColor(mat) })
        continue
      }
      if (lod === 0 && (await mergeAsSmallProp(mat, grp.layer, g.idx.length / 3))) {
        small.push({ g, color: await averageColor(mat) })
        continue
      }
      usedMaterials.add(mat)
      // '__' separator: three's GLTFLoader strips ':' and '.' from node names.
      addMesh(doc, `${grp.layer}__${mat}`, g, mat, stubs)
      tris += g.idx.length / 3
    }
    if (small.length) {
      const g = mergeColored(small)
      addMesh(doc, 'prop__small', g, VERTEX_COLOR_MATERIAL, stubs)
      tris += g.idx.length / 3
    }
    if (merged.length) {
      // Far LOD: every non-vegetation mesh in the chunk merged into ONE draw call,
      // texture replaced by the material's average colour baked into vertices.
      const g = mergeColored(merged)
      addMesh(doc, 'merged__lod1', g, VERTEX_COLOR_MATERIAL, stubs)
      tris += g.idx.length / 3
    }
    if (!tris) continue
    const rel = `chunks/${id}_lod${lod}.glb`
    const bytes = await writeDoc(doc, rel)
    entry.lods.push({ url: rel, bytes, tris })
    totals[`lod${lod}`] += tris
    totals[`bytes${lod}`] += bytes
  }
  if (!entry.lods.length) continue
  entry.min = entry.min.map(round)
  entry.max = entry.max.map(round)
  manifestChunks.push(entry)

  // Collision: positions only, one mesh per layer so the runtime can tag barriers.
  // Road and ground are simplified separately, so the vertices where they meet
  // are locked: free, each side pulled its edge in on its own and left thin
  // cracks along every kerb and verge that wheels dropped into and cars sank
  // through.
  const floors = {}
  for (const layer of ['road', 'ground']) {
    const parts = colParts.filter((c) => c.layer === layer).flatMap((c) => c.parts)
    if (parts.length) floors[layer] = weld(gather(parts, false), 'pos')
  }
  const seamKey = (pos, v) => `${Math.round(pos[v * 3] * 50)},${Math.round(pos[v * 3 + 1] * 50)},${Math.round(pos[v * 3 + 2] * 50)}`
  if (floors.road && floors.ground) {
    const keys = (g) => { const k = new Set(); for (let v = 0; v < g.pos.length / 3; v++) k.add(seamKey(g.pos, v)); return k }
    const roadKeys = keys(floors.road), groundKeys = keys(floors.ground)
    for (const [g, other] of [[floors.road, groundKeys], [floors.ground, roadKeys]]) {
      for (let v = 0; v < g.pos.length / 3; v++) if (other.has(seamKey(g.pos, v))) g.lock[v] = 1
    }
  }
  for (const layer of ['road', 'ground', 'barrier']) {
    let welded = floors[layer]
    if (!welded) {
      const parts = colParts.filter((c) => c.layer === layer).flatMap((c) => c.parts)
      if (!parts.length) continue
      welded = weld(gather(parts, false), 'pos')
    }
    let g = simplify(welded, cfg.collisionError[layer])
    if (g && layer === 'road') g = skirt(g, cfg.collisionSkirt ?? 2.5, 0.3, floorCover(Object.values(floors)))
    if (!g) continue
    collisionParts.push({ name: `${layer}__${id}`, g })
    totals.col += g.idx.length / 3
  }
}
log('tris by layer', layerTris)
log('top lod0 materials', Object.entries(matTris).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([m, n]) => `${m}:${n}`).join(' '))
log(`chunks: lod0 ${totals.lod0.toLocaleString()} tris / ${(totals.bytes0 / 1e6).toFixed(1)} MB, lod1 ${totals.lod1.toLocaleString()} tris / ${(totals.bytes1 / 1e6).toFixed(1)} MB`)

// ── 7. Terrain backdrop + collision ────────────────────────────────────────
const terrainPrims = prims.filter((p) => p.layer === 'terrain')
let backdropBytes = 0
if (terrainPrims.length) {
  const parts = terrainPrims.map((pr) => ({ pr, tris: Array.from({ length: pr.idx.length / 3 }, (_, t) => t) }))
  const g = simplify(weld(gather(parts), 'posnrm'), cfg.terrainError)
  const doc = newDoc()
  for (const pr of terrainPrims) usedMaterials.add(pr.mat)
  addMesh(doc, `terrain__${terrainPrims[0].mat}`, g, terrainPrims[0].mat, new Map())
  backdropBytes = await writeDoc(doc, 'backdrop.glb')
  const col = simplify(weld(gather(parts, false), 'pos'), cfg.collisionError.terrain)
  collisionParts.push({ name: 'terrain__backdrop', g: col })
  totals.col += col.idx.length / 3
  log(`backdrop ${(g.idx.length / 3).toLocaleString()} tris, ${(backdropBytes / 1e3).toFixed(0)} KB`)
}

{
  const doc = newDoc()
  for (const { name, g } of collisionParts) addMesh(doc, name, g, null, null)
  // 16-bit positions: ~3 mm steps per 200 m chunk, so wheels don't feel quantisation.
  const bytes = await writeDoc(doc, 'collision.glb', 16)
  log(`collision ${totals.col.toLocaleString()} tris, ${(bytes / 1e6).toFixed(2)} MB`)
  totals.colBytes = bytes
}

// ── 8. Material libraries ──────────────────────────────────────────────────
/** Alpha mode for an output material: cfg.alpha override, else false-BLEND fix, else per layer. */
async function alphaModeFor(m, layer) {
  const forced = cfg.alpha?.find(([re]) => re.test(m.getName()))
  if (forced) return forced[1]
  const mode = m.getAlphaMode()
  if (mode !== 'BLEND') return mode
  if (await textureIsOpaque(m.getBaseColorTexture())) return 'OPAQUE'
  // Blended cards → alpha test: no sorting, far less overdraw on mobile GPUs.
  return layer === 'veg' || layer === 'prop' || layer === 'barrier' ? 'MASK' : 'BLEND'
}

async function writeMaterials(tier, maxSize) {
  const doc = newDoc()
  const texMap = new Map()
  const tt = doc.createExtension(KHRTextureTransform)
  const copyTex = (info, srcTex) => {
    let tex = texMap.get(srcTex)
    if (!tex) texMap.set(srcTex, (tex = doc.createTexture(srcTex.getName()).setImage(srcTex.getImage()).setMimeType(srcTex.getMimeType())))
    return tex
  }
  for (const m of src.getRoot().listMaterials()) {
    const name = m.getName()
    if (!usedMaterials.has(name)) continue
    const layer = layerOf(name)
    const out = doc.createMaterial(name)
      .setBaseColorFactor(await tintedFactor(m))
      .setEmissiveFactor(m.getEmissiveFactor())
      .setDoubleSided(m.getDoubleSided() || layer === 'veg')
      .setMetallicFactor(0)
      .setRoughnessFactor(Math.max(0.6, m.getRoughnessFactor()))
    const alpha = await alphaModeFor(m, layer)
    out.setAlphaMode(alpha).setAlphaCutoff(alpha === 'MASK' && m.getAlphaMode() !== 'MASK' ? 0.5 : m.getAlphaCutoff())
    out.setExtras({ layer })
    const base = m.getBaseColorTexture()
    if (base) {
      out.setBaseColorTexture(copyTex(m.getBaseColorTextureInfo(), base))
      const srcT = m.getBaseColorTextureInfo().getExtension('KHR_texture_transform')
      if (srcT) {
        out.getBaseColorTextureInfo().setExtension('KHR_texture_transform',
          tt.createTransform().setOffset(srcT.getOffset()).setScale(srcT.getScale()).setRotation(srcT.getRotation()))
      }
      out.getBaseColorTextureInfo().setTexCoord(0)
    }
    const emissive = m.getEmissiveTexture()
    if (emissive) out.setEmissiveTexture(copyTex(m.getEmissiveTextureInfo(), emissive))
  }
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxSize, maxSize], quality: 82 }))
  const bytes = await io.writeBinary(doc)
  await fs.writeFile(path.join(outDir, `materials_${tier}.glb`), bytes)
  log(`materials_${tier}: ${doc.getRoot().listMaterials().length} materials, ${doc.getRoot().listTextures().length} textures, ${(bytes.byteLength / 1e6).toFixed(2)} MB`)
  return bytes.byteLength
}
const matBytes = { high: await writeMaterials('high', cfg.textures.high), low: await writeMaterials('low', cfg.textures.low) }

// ── 9. Manifest ────────────────────────────────────────────────────────────
/** Re-index the closed line so point 0 is the one nearest the start line (the origin). */
function rotateToStart(pts) {
  let best = 0
  for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i][0], pts[i][2]) < Math.hypot(pts[best][0], pts[best][2])) best = i
  return [...pts.slice(best), ...pts.slice(0, best)]
}
const xzLen = (d) => Math.hypot(d[0], d[1])
const checkpoints = gates.map((g, index) => {
  const l = xzLen(g.dir)
  return {
    index,
    position: [round(g.at[0] - origin[0]), round(g.y - origin[1]), round(g.at[1] - origin[2])],
    tangent: [round(g.dir[0] / l), 0, round(g.dir[1] / l)],
    radius: cfg.checkpointRadius,
  }
})
const t = checkpoints[0].tangent
const spawnXZ = [-t[0] * cfg.spawnBehind, -t[2] * cfg.spawnBehind]
const spawnGround = heightAt(spawnXZ[0], spawnXZ[1], ['road'])
const manifest = {
  version: 1,
  id: cfg.id,
  name: cfg.name,
  chunkSize: S,
  sourceOrigin: origin.map(round),
  materials: { high: 'materials_high.glb', low: 'materials_low.glb' },
  // No terrain layer (a city block): no backdrop file, so none in the manifest either.
  backdrop: backdropBytes ? 'backdrop.glb' : null,
  collision: 'collision.glb',
  spawn: { position: [round(spawnXZ[0]), round((spawnGround?.y ?? 0) + 0.6), round(spawnXZ[1])], heading: round(Math.atan2(t[0], t[2])) },
  checkpoints,
  // Closed centreline [x, y, z] every ~4 m, starting at the start line, in race direction.
  line: rotateToStart(line.points.map(([x, y, z]) => [round(x - origin[0]), round(y - origin[1]), round(z - origin[2])])),
  lineLength: Math.round(line.length),
  chunks: manifestChunks,
  stats: {
    lod0Tris: totals.lod0, lod1Tris: totals.lod1, collisionTris: totals.col,
    bytes: { lod0: totals.bytes0, lod1: totals.bytes1, collision: totals.colBytes, backdrop: backdropBytes, materials: matBytes },
  },
}
await fs.writeFile(path.join(outDir, 'track.json'), JSON.stringify(manifest, null, 1))
log('wrote', path.relative(process.cwd(), outDir), `${manifestChunks.length} chunks`)
