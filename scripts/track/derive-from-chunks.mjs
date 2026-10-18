// Re-derives the centreline and the surface map of a built track from its
// shipped LOD0 chunks, without the multi-hundred-MB source GLB.
//
//   node scripts/track/derive-from-chunks.mjs scripts/track/nurburgring.config.mjs
//
// 1. Centreline: traced over cfg.lineSurface between the manifest's gates plus
//    cfg.lineVia points (source coords, like the gates), same as build-track.
// 2. Surface map: the top-most drivable surface per 1 m cell (asphalt, kerb,
//    grass, sand, gravel), run-length encoded to surface.bin. The game reads it
//    for tire grip / rolling drag and for sand / dust effects.
//
// Rewrites track.json (line, lineLength, surface) in place.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { traceCenterline } from './centerline.mjs'

const configPath = process.argv[2]
if (!configPath) throw new Error('usage: derive-from-chunks.mjs <config.mjs>')
const cfg = (await import(pathToFileURL(path.resolve(configPath)).href)).default
const outDir = path.resolve(cfg.out)
const manifestPath = path.join(outDir, 'track.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const [ox, , oz] = manifest.sourceOrigin

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

// ── Read LOD0 chunks (node names are `<layer>__<material>`) ─────────────────
/** Same codes as src/world/Surface.ts. */
const SURFACE = { none: 0, asphalt: 1, kerb: 2, grass: 3, sand: 4, gravel: 5 }
/** cfg.surfaces: [[materialRegex, 'asphalt' | 'kerb' | 'grass' | 'sand' | 'gravel']], first match wins. */
const surfaceOf = (mat) =>
  cfg.surfaces ? SURFACE[cfg.surfaces.find(([re]) => re.test(mat))?.[1] ?? 'none']
  : /^curb/.test(mat) ? SURFACE.kerb
  : /^sand/.test(mat) ? SURFACE.sand
  : /^gravel/.test(mat) ? SURFACE.gravel
  : /^(grass|astroturf|travert_grass)/.test(mat) ? SURFACE.grass
  : /^(asph|pits|conc_|tiles|travert|pavement)/.test(mat) ? SURFACE.asphalt
  : SURFACE.none

const prims = []
for (const c of manifest.chunks) {
  const doc = await io.read(path.join(outDir, c.lods[0].url))
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const [layer] = node.getName().split('__')
    if (layer !== 'road' && layer !== 'ground') continue
    const m = node.getWorldMatrix()
    for (const prim of mesh.listPrimitives()) {
      const acc = prim.getAttribute('POSITION')
      const pos = new Float32Array(acc.getCount() * 3)
      const e = [0, 0, 0]
      for (let i = 0; i < acc.getCount(); i++) {
        acc.getElement(i, e) // de-quantises KHR_mesh_quantization
        const [x, y, z] = e
        pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
        pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
        pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
      }
      const mat = prim.getMaterial()?.getName() ?? ''
      prims.push({ pos, idx: prim.getIndices().getArray(), mat, layer, surface: surfaceOf(mat) })
    }
  }
}
console.log(`read ${manifest.chunks.length} chunks, ${prims.length} road/ground primitives`)

// ── 1. Centreline ───────────────────────────────────────────────────────────
const toRuntime = ([x, z]) => [x - ox, z - oz]
const waypoints = manifest.checkpoints.flatMap((g, i) => [
  [g.position[0], g.position[2]],
  ...(cfg.lineVia?.[i] ?? []).map(toRuntime),
])
const line = traceCenterline(prims, cfg.lineSurface, waypoints, { spacing: cfg.lineSpacing ?? 4 })
const round = (v) => Math.round(v * 100) / 100
let start = 0
for (let i = 1; i < line.points.length; i++) {
  if (Math.hypot(line.points[i][0], line.points[i][2]) < Math.hypot(line.points[start][0], line.points[start][2])) start = i
}
manifest.line = [...line.points.slice(start), ...line.points.slice(0, start)].map((p) => p.map(round))
manifest.lineLength = Math.round(line.length)
console.log(`centreline ${manifest.line.length} points, ${(line.length / 1000).toFixed(2)} km`)

// ── 2. Surface map ──────────────────────────────────────────────────────────
const RES = 1
let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
for (const p of prims) {
  if (!p.surface) continue
  for (let i = 0; i < p.pos.length; i += 3) {
    x0 = Math.min(x0, p.pos[i]); x1 = Math.max(x1, p.pos[i]); z0 = Math.min(z0, p.pos[i + 2]); z1 = Math.max(z1, p.pos[i + 2])
  }
}
x0 = Math.floor(x0); z0 = Math.floor(z0)
const W = Math.ceil((x1 - x0) / RES) + 1, H = Math.ceil((z1 - z0) / RES) + 1
const grid = new Uint8Array(W * H)
const top = new Float32Array(W * H).fill(-Infinity)
/** Road wins over a ground triangle within this height of it (kerbs and asphalt overlap grass edges). */
const ROAD_BIAS = 0.08
for (const p of prims) {
  if (!p.surface) continue
  const bias = p.layer === 'road' ? ROAD_BIAS : 0
  const { pos, idx } = p
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
    const ax = (pos[a] - x0) / RES, az = (pos[a + 2] - z0) / RES
    const bx = (pos[b] - x0) / RES, bz = (pos[b + 2] - z0) / RES
    const cx = (pos[c] - x0) / RES, cz = (pos[c + 2] - z0) / RES
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
    if (d === 0) continue
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx))), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)))
    const minZ = Math.max(0, Math.floor(Math.min(az, bz, cz))), maxZ = Math.min(H - 1, Math.ceil(Math.max(az, bz, cz)))
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, pz = z + 0.5
      const w0 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / d
      const w1 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
      const w2 = 1 - w0 - w1
      if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue
      const y = w0 * pos[a + 1] + w1 * pos[b + 1] + w2 * pos[c + 1] + bias
      const o = z * W + x
      if (y > top[o]) { top[o] = y; grid[o] = p.surface }
    }
  }
}

// Run-length encode row-major: [code, run (LEB128 varint)]... — see decodeSurfaceRle().
const bytes = []
for (let i = 0; i < grid.length; ) {
  let j = i
  while (j < grid.length && grid[j] === grid[i]) j++
  bytes.push(grid[i])
  for (let run = j - i; ; ) {
    const b = run & 0x7f
    run >>>= 7
    if (run) bytes.push(b | 0x80)
    else { bytes.push(b); break }
  }
  i = j
}
await fs.writeFile(path.join(outDir, 'surface.bin'), Buffer.from(bytes))
const counts = Object.fromEntries(Object.entries(SURFACE).map(([k, v]) => [k, grid.reduce((n, g) => n + (g === v ? 1 : 0), 0)]))
console.log(`surface ${W}x${H} @ ${RES} m, ${(bytes.length / 1024).toFixed(0)} KB`, counts)
manifest.surface = { url: 'surface.bin', x0, z0, res: RES, width: W, height: H }

await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 1))
console.log('wrote', path.relative(process.cwd(), manifestPath))
