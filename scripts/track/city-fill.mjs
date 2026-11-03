// Turns a shipped city track into a whole city: a post-build step on the track package (no
// source GLB needed), run after build-track.mjs and before derive-from-chunks.mjs.
//
//   node scripts/track/city-fill.mjs scripts/track/city.config.mjs
//
// City sources are a few streets with nothing around them: side streets end at the edge of the
// world, there is no ground between the blocks, and game-ripped buildings are walls without
// collision (a car drives into them and falls through the floor). From cfg.cityFill it:
//
// 1. Fills every hole with pavement: a height field that follows the existing floor and carries
//    it smoothly out to the edge of the fill area.
// 2. Lays a street grid (cfg.cityFill.roads, axis-aligned lines in track coordinates) wherever
//    there is no existing floor, so the dead-end streets run on into new ones.
// 3. Puts buildings on the blocks between the streets, away from the existing scenery, and a
//    ring of them along the edge, behind an invisible wall.
// 4. Gives the existing buildings collision: tall prop components get their walls as barriers.
//
// Everything new uses one generated texture atlas (material `cityfill_atlas`), so a fill chunk
// is two draw calls (ground + roads, buildings). Fill chunks are separate manifest entries
// (`f_<i>_<j>`), collision nodes are `<layer>__fill…`: a rerun replaces them all.
//
// cfg.cityFill: {
//   margin: m of city around the existing chunks,
//   roads: { x: [...], z: [...] } street centre lines (track coords: metres from the start line),
//   roadWidth?: 12, lot?: 30, heights?: [min, max] building height (m), seed?: number,
//   existingWalls?: true (collide the existing buildings' walls),
//   openOnly?: false (streets and buildings only where open ground reaches the edge of the fill
//     area: not inside blocks walled in by existing buildings, which a game-ripped city leaves hollow)
// }
import { Document, Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const configPath = process.argv[2]
if (!configPath) throw new Error('usage: city-fill.mjs <config.mjs>')
const cfg = (await import(pathToFileURL(path.resolve(configPath)).href)).default
const F = cfg.cityFill
if (!F) throw new Error(`${configPath} has no cityFill`)
const ROAD_W = F.roadWidth ?? 12
const LOT = F.lot ?? 30
const [H_MIN, H_MAX] = F.heights ?? [14, 70]
const SEED = F.seed ?? 1
const MAT = 'cityfill_atlas'

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })
const outDir = path.resolve(cfg.out)
const manifestPath = path.join(outDir, 'track.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)
const hash01 = (...n) => { let x = SEED * 0x9e3779b9; for (const v of n) { x = Math.imul(x ^ (v | 0), 0x85ebca6b); x ^= x >>> 13 } x = Math.imul(x, 0xc2b2ae35); return ((x ^ (x >>> 16)) >>> 0) / 4294967296 }

// ── Read the package as built (fill parts from an earlier run are skipped) ──
/** Every triangle of a doc's meshes in world space: { name, pos: Float32Array, idx: Uint32Array }. */
async function readMeshes(file) {
  const doc = await io.read(file)
  const out = []
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const m = node.getWorldMatrix()
    for (const prim of mesh.listPrimitives()) {
      const acc = prim.getAttribute('POSITION')
      const pos = new Float32Array(acc.getCount() * 3)
      const e = [0, 0, 0]
      for (let i = 0; i < acc.getCount(); i++) {
        acc.getElement(i, e)
        const [x, y, z] = e
        pos[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
        pos[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
        pos[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
      }
      const ia = prim.getIndices()
      out.push({ name: node.getName(), pos, idx: ia ? Uint32Array.from(ia.getArray()) : Uint32Array.from({ length: acc.getCount() }, (_, i) => i) })
    }
  }
  return out
}

const baseChunks = manifest.chunks.filter((c) => !c.id.startsWith('f_'))
const collision = (await readMeshes(path.join(outDir, manifest.collision))).filter((m) => !m.name.includes('__fill'))
const visual = []
for (const c of baseChunks) for (const m of await readMeshes(path.join(outDir, c.lods[0].url))) visual.push(m)
log(`${baseChunks.length} chunks, ${collision.length} collision meshes, ${visual.length} visual meshes`)

// ── Rasters on a 4 m grid ───────────────────────────────────────────────────
const C = 4
let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity
for (const c of baseChunks) { bx0 = Math.min(bx0, c.min[0]); bz0 = Math.min(bz0, c.min[2]); bx1 = Math.max(bx1, c.max[0]); bz1 = Math.max(bz1, c.max[2]) }
const X0 = Math.floor((bx0 - F.margin) / 8) * 8, Z0 = Math.floor((bz0 - F.margin) / 8) * 8
const X1 = Math.ceil((bx1 + F.margin) / 8) * 8, Z1 = Math.ceil((bz1 + F.margin) / 8) * 8
const NX = (X1 - X0) / C, NZ = (Z1 - Z0) / C
const NXc = NX, NZc = NZ
const cell = (x, z) => { const i = Math.floor((x - X0) / C), j = Math.floor((z - Z0) / C); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : j * NX + i }
log(`fill area ${X1 - X0} × ${Z1 - Z0} m (${NX} × ${NZ} cells)`)

/** Calls fn(cellIndex, y) for each cell whose centre lies in the triangle, plus each vertex's cell. */
function rasterize(pos, idx, fn, C = 4, NX = NXc, NZ = NZc) {
  const cell = (x, z) => { const i = Math.floor((x - X0) / C), j = Math.floor((z - Z0) / C); return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : j * NX + i }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
    const ax = pos[a], az = pos[a + 2], bxp = pos[b], bzp = pos[b + 2], cx = pos[c], cz = pos[c + 2]
    const d = (bzp - cz) * (ax - cx) + (cx - bxp) * (az - cz)
    if (Math.abs(d) > 1e-6) {
      const i0 = Math.max(0, Math.floor((Math.min(ax, bxp, cx) - X0) / C)), i1 = Math.min(NX - 1, Math.floor((Math.max(ax, bxp, cx) - X0) / C))
      const j0 = Math.max(0, Math.floor((Math.min(az, bzp, cz) - Z0) / C)), j1 = Math.min(NZ - 1, Math.floor((Math.max(az, bzp, cz) - Z0) / C))
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = X0 + (i + 0.5) * C, pz = Z0 + (j + 0.5) * C
        const l1 = ((bzp - cz) * (px - cx) + (cx - bxp) * (pz - cz)) / d
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / d
        const l3 = 1 - l1 - l2
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue
        fn(j * NX + i, l1 * pos[a + 1] + l2 * pos[b + 1] + l3 * pos[c + 1])
      }
    }
    for (const v of [a, b, c]) { const k = cell(pos[v], pos[v + 2]); if (k >= 0) fn(k, pos[v + 1]) }
  }
}

/**
 * Height of the existing floor (road, ground, terrain collision) per cell; -Infinity where there's
 * none. The lowest surface in the cell, not the top: some sources' ground layer carries roof
 * plates too, and a roof isn't the level the city's streets run on.
 */
const floorH = new Float32Array(NX * NZ).fill(Infinity)
for (const m of collision) if (!m.name.startsWith('barrier')) rasterize(m.pos, m.idx, (k, y) => { if (y < floorH[k]) floorH[k] = y })
for (let k = 0; k < floorH.length; k++) if (floorH[k] === Infinity) floorH[k] = -Infinity
// A roof standing alone over the void still reads as floor: drop cells over 3 m above the median
// of the floor around them (64 m blocks), so they don't lift the new city into the air.
{
  const B = 16
  for (let bj = 0; bj < NZ; bj += B) for (let bi = 0; bi < NX; bi += B) {
    const hs = []
    for (let j = Math.max(0, bj - B); j < Math.min(NZ, bj + 2 * B); j++) for (let i = Math.max(0, bi - B); i < Math.min(NX, bi + 2 * B); i++) if (floorH[j * NX + i] > -Infinity) hs.push(floorH[j * NX + i])
    if (!hs.length) continue
    hs.sort((a, b) => a - b)
    const median = hs[hs.length >> 1]
    for (let j = bj; j < Math.min(NZ, bj + B); j++) for (let i = bi; i < Math.min(NX, bi + B); i++) if (floorH[j * NX + i] > median + 3) floorH[j * NX + i] = -Infinity
  }
}
/** Cells with any existing scenery in them (buildings, props, floor). */
const occupied = new Uint8Array(NX * NZ)
for (const m of visual) if (!m.name.startsWith('veg')) rasterize(m.pos, m.idx, (k) => { occupied[k] = 1 })
const hasFloor = (k) => floorH[k] > -Infinity
/** The same floor on a 1 m grid: where exactly the existing floor ends. */
const NXF = NX * C, NZF = NZ * C
const floorFine = new Uint8Array(NXF * NZF)
for (const m of collision) if (!m.name.startsWith('barrier')) rasterize(m.pos, m.idx, (k) => { floorFine[k] = 1 }, 1, NXF, NZF)
/**
 * Existing walls: barrier collision, or any scenery standing over 2.5 m above the floor (or with
 * no floor under it at all: a game-ripped building is walls round a hole). A new street never
 * runs into one.
 */
const wallCell = new Uint8Array(NX * NZ)
for (const m of collision) if (m.name.startsWith('barrier')) rasterize(m.pos, m.idx, (k) => { wallCell[k] = 1 })
for (const m of visual) if (!m.name.startsWith('veg')) rasterize(m.pos, m.idx, (k, y) => { if (!hasFloor(k) || y > floorH[k] + 2.5) wallCell[k] = 1 })
{
  let lo = Infinity, hi = -Infinity
  for (const h of floorH) if (h > -Infinity) { lo = Math.min(lo, h); hi = Math.max(hi, h) }
  log(`floor heights ${lo.toFixed(2)} … ${hi.toFixed(2)} m`)
}

// Height of the new city: the existing floor, carried out over the holes. Cells are filled in
// rings from the floor outward (each the mean of its filled neighbours), then smoothed.
const H = new Float32Array(NX * NZ)
const known = new Uint8Array(NX * NZ)
{
  let ring = []
  for (let k = 0; k < NX * NZ; k++) if (hasFloor(k)) { H[k] = floorH[k]; known[k] = 1; ring.push(k) }
  const neighbours = (k) => { const i = k % NX, j = (k - i) / NX, out = []; if (i > 0) out.push(k - 1); if (i < NX - 1) out.push(k + 1); if (j > 0) out.push(k - NX); if (j < NZ - 1) out.push(k + NX); return out }
  while (ring.length) {
    const next = new Set()
    for (const k of ring) for (const n of neighbours(k)) if (!known[n]) next.add(n)
    for (const k of next) { let s = 0, w = 0; for (const n of neighbours(k)) if (known[n]) { s += H[n]; w++ } H[k] = s / w }
    for (const k of next) known[k] = 2
    ring = [...next]
  }
  for (let pass = 0; pass < 60; pass++) for (let k = 0; k < NX * NZ; k++) {
    if (known[k] !== 2) continue
    let s = 0, w = 0
    for (const n of neighbours(k)) { s += H[n]; w++ }
    H[k] = s / w
  }
}
/** Bilinear height at any point (cell centres carry H). */
function heightAt(x, z) {
  const fx = Math.min(NX - 1.001, Math.max(0, (x - X0) / C - 0.5)), fz = Math.min(NZ - 1.001, Math.max(0, (z - Z0) / C - 0.5))
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j
  const h = (ii, jj) => H[Math.min(NZ - 1, jj) * NX + Math.min(NX - 1, ii)]
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v
}
const floorAt = (x, z) => { const i = Math.floor(x - X0), j = Math.floor(z - Z0); return i >= 0 && j >= 0 && i < NXF && j < NZF && floorFine[j * NXF + i] === 1 }

// ── Atlas: 4 × 2 tiles of 256 px ────────────────────────────────────────────
const TILE = 256, AW = TILE * 4, AH = TILE * 2
const TILES = { lane: 0, asphalt: 1, pavement: 2, roof: 3, glass: 4, brick: 5, office: 6, dark: 7 }
const FACADES = ['glass', 'brick', 'office', 'dark']
const atlas = Buffer.alloc(AW * AH * 3)
const tileColor = {}
{
  const noise = (x, y, s) => hash01(x * 7919 + y * 104729 + s) - 0.5
  const paint = (tile, fn) => {
    const ox = (tile % 4) * TILE, oy = Math.floor(tile / 4) * TILE
    const sum = [0, 0, 0]
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const c = fn(x, y)
      const i = ((oy + y) * AW + ox + x) * 3
      for (let k = 0; k < 3; k++) { const v = Math.max(0, Math.min(255, Math.round(c[k]))); atlas[i + k] = v; sum[k] += v }
    }
    tileColor[tile] = sum.map((v) => ((v / TILE / TILE / 255) ** 2.2))
  }
  const asphalt = (x, y) => { const n = 58 + noise(x, y, 1) * 16 + noise(x >> 3, y >> 3, 2) * 8; return [n, n, n + 3] }
  // u (x) runs across the road, v (y) along it: one tile is 12 m of road.
  paint(TILES.lane, (x, y) => {
    const edge = (x >= 12 && x < 18) || (x >= TILE - 18 && x < TILE - 12)
    const centre = Math.abs(x - TILE / 2) < 3 && (y % 128) < 72
    if (edge) return [205, 205, 200]
    if (centre) return [222, 182, 60]
    return asphalt(x, y)
  })
  paint(TILES.asphalt, asphalt)
  paint(TILES.pavement, (x, y) => {
    const joint = x % 64 < 2 || y % 64 < 2
    const n = 150 + noise(x, y, 3) * 14 + noise(x >> 6, y >> 6, 4) * 14
    return joint ? [n - 45, n - 45, n - 42] : [n, n - 2, n - 6]
  })
  paint(TILES.roof, (x, y) => {
    const rim = x < 8 || y < 8 || x >= TILE - 8 || y >= TILE - 8
    const n = 72 + noise(x, y, 5) * 20
    return rim ? [120, 118, 112] : [n, n, n + 2]
  })
  // Facades: one tile is 3 floors × 3 bays (12 × 12 m). wall(x, y) and window(x, y, lit).
  const facade = (tile, wall, window, frame) => paint(tile, (x, y) => {
    const fy = y % 85, fx = x % 85
    const inWin = fx > frame[0] && fx < 85 - frame[0] && fy > frame[1] && fy < 85 - frame[2]
    if (!inWin) return wall(x, y)
    const lit = hash01(Math.floor(x / 85), Math.floor(y / 85), tile) > 0.82
    return window(x, y, lit, (fy - frame[1]) / (85 - frame[1] - frame[2]))
  })
  facade(TILES.glass, (x, y) => [70 + noise(x, y, 6) * 6, 92, 104], (x, y, lit, v) => lit ? [210, 190, 130] : [40 + v * 70, 70 + v * 70, 96 + v * 70], [4, 6, 6])
  facade(TILES.brick, (x, y) => { const mortar = y % 6 === 0 || (x + (Math.floor(y / 6) % 2) * 6) % 12 === 0; const n = noise(x, y, 7) * 18; return mortar ? [150, 140, 130] : [128 + n, 64 + n / 2, 48 + n / 2] }, (x, y, lit, v) => lit ? [235, 200, 120] : [36 + v * 30, 44 + v * 30, 56 + v * 30], [22, 18, 20])
  facade(TILES.office, (x, y) => { const n = 186 + noise(x, y, 8) * 10; return [n, n, n - 6] }, (x, y, lit, v) => lit ? [230, 220, 170] : [52 + v * 40, 64 + v * 44, 78 + v * 50], [6, 26, 14])
  facade(TILES.dark, (x, y) => { const n = 44 + noise(x, y, 9) * 6; return [n, n, n + 4] }, (x, y, lit, v) => lit ? [255, 205, 120] : [24 + v * 26, 30 + v * 30, 40 + v * 36], [10, 12, 12])
}
const PAD = 2
const uvOf = (tile, u, v) => {
  const ox = (tile % 4) * TILE, oy = Math.floor(tile / 4) * TILE
  return [(ox + PAD + u * (TILE - 2 * PAD)) / AW, (oy + PAD + v * (TILE - 2 * PAD)) / AH]
}

// ── Geometry, bucketed by chunk ─────────────────────────────────────────────
const S = manifest.chunkSize
const buckets = new Map() // id → { i, j, ground, road, build, colGround, colRoad, colBarrier } of { pos, uv, color, idx }
const mesh = () => ({ pos: [], uv: [], color: [], idx: [] })
function bucketFor(x, z) {
  const i = Math.floor(x / S), j = Math.floor(z / S), id = `f_${i}_${j}`
  let b = buckets.get(id)
  if (!b) buckets.set(id, (b = { id, i, j, lod0: { ground: mesh(), build: mesh() }, lod1: { ground: mesh(), build: mesh() }, col: { ground: mesh(), road: mesh(), barrier: mesh() } }))
  return b
}
/** A quad a-b-c-d (counter-clockwise from above for floors; outward for walls) with per-corner UVs. */
function quad(m, p, uv, tile) {
  const base = m.pos.length / 3
  for (let k = 0; k < 4; k++) {
    m.pos.push(...p[k])
    if (uv) m.uv.push(...uvOf(tile, uv[k][0], uv[k][1]))
    else m.color.push(...tileColor[tile])
  }
  m.idx.push(base, base + 2, base + 1, base, base + 3, base + 2)
}
const colQuad = (m, p) => { const base = m.pos.length / 3; for (const v of p) m.pos.push(...v); m.idx.push(base, base + 2, base + 1, base, base + 3, base + 2) }

// Open ground: cells reachable from the edge of the fill area without crossing floor or a wall.
const open = new Uint8Array(NX * NZ)
if (F.openOnly) {
  const stack = []
  const push = (i, j) => { if (i < 0 || j < 0 || i >= NX || j >= NZ) return; const k = j * NX + i; if (open[k] || hasFloor(k) || wallCell[k]) return; open[k] = 1; stack.push(k) }
  for (let i = 0; i < NX; i++) { push(i, 0); push(i, NZ - 1) }
  for (let j = 0; j < NZ; j++) { push(0, j); push(NX - 1, j) }
  while (stack.length) { const k = stack.pop(), i = k % NX, j = (k - i) / NX; push(i - 1, j); push(i + 1, j); push(i, j - 1); push(i, j + 1) }
} else open.fill(1)

// Streets: lines snapped so their edges land on the 4 m grid.
const snapLine = (v) => Math.round((v - 2) / 4) * 4 + 2
const xs = (F.roads?.x ?? []).map(snapLine), zs = (F.roads?.z ?? []).map(snapLine)
const half = ROAD_W / 2
const roadCell = new Uint8Array(NX * NZ)
const markRoad = (xa, za, xb, zb) => { for (let z = za + C / 2; z < zb; z += C) for (let x = xa + C / 2; x < xb; x += C) { const k = cell(x, z); if (k >= 0) roadCell[k] = 1 } }
// Small props (lamps, signs, litter) don't stop a street; existing floor and walls do.
const blockedForRoad = (x, z) => floorAt(x, z) || cell(x, z) < 0 || wallCell[cell(x, z)] === 1 || !open[cell(x, z)]
const inIntersection = (x, z) => xs.some((lx) => Math.abs(x - lx) < half) && zs.some((lz) => Math.abs(z - lz) < half)
// Height a new street vertex sits at: just over the fill, tucked just under an existing road it meets.
const streetY = (x, z) => heightAt(x, z) + (floorAt(x, z) ? -0.02 : 0.04)
let roadTris = 0
function emitRoadPiece(x0, z0, x1, z1, alongX, k) {
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2
  // Skip where the city already has floor (the street it extends) or a building.
  const across = alongX ? [[mx, z0 + 2], [mx, mz], [mx, z1 - 2]] : [[x0 + 2, mz], [mx, mz], [x1 - 2, mz]]
  if (across.some(([x, z]) => blockedForRoad(x, z))) return
  const b = bucketFor(mx, mz)
  const p = [[x0, streetY(x0, z0), z0], [x1, streetY(x1, z0), z0], [x1, streetY(x1, z1), z1], [x0, streetY(x0, z1), z1]]
  const plain = inIntersection(mx, mz)
  const v0 = (k % 3) / 3, v1 = v0 + 1 / 3
  // Lane tile: u across the road, v along it.
  const uv = alongX ? [[0, v0], [0, v1], [1, v1], [1, v0]] : [[0, v0], [1, v0], [1, v1], [0, v1]]
  const tile = plain ? TILES.asphalt : TILES.lane
  quad(b.lod0.ground, p, plain ? [[0, 0], [1, 0], [1, 1], [0, 1]] : uv, tile)
  quad(b.lod1.ground, p, null, TILES.asphalt)
  colQuad(b.col.road, p)
  markRoad(x0, z0, x1, z1)
  roadTris += 2
}
for (const lz of zs) for (let x = X0, k = 0; x < X1; x += C, k++) emitRoadPiece(x, lz - half, x + C, lz + half, true, k)
for (const lx of xs) for (let z = Z0, k = 0; z < Z1; z += C, k++) if (!inIntersection(lx, z + C / 2)) emitRoadPiece(lx - half, z, lx + half, z + C, false, k)
log(`streets: ${roadTris.toLocaleString()} tris over ${xs.length} + ${zs.length} lines`)

// Ground: every 4 m cell not under existing floor or a new street. A corner that touches existing
// floor drops 12 cm, so the fill slips under the existing kerb edge instead of z-fighting it.
let groundTris = 0
{
  const touchesFloor = (x, z) => [[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dz]) => floorAt(x + dx, z + dz))
  const gy = (x, z) => heightAt(x, z) - (touchesFloor(x, z) ? 0.12 : 0)
  const emit = (x, z, size) => {
    const b = bucketFor(x + size / 2, z + size / 2)
    const p = [[x, gy(x, z), z], [x + size, gy(x + size, z), z], [x + size, gy(x + size, z + size), z + size], [x, gy(x, z + size), z + size]]
    // The pavement tile covers 16 m: a 4 m cell shows a quarter of it, an 8 m cell half.
    const f = size / 16
    const u0 = ((x - X0) % 16) / 16, v0 = ((z - Z0) % 16) / 16
    quad(b.lod0.ground, p, [[u0, v0], [u0 + f, v0], [u0 + f, v0 + f], [u0, v0 + f]], TILES.pavement)
    colQuad(b.col.ground, p)
    groundTris += 2
  }
  // 8 m cells in the open; 4 m cells where existing floor or a new street is near, so the fill
  // meets their edges closely.
  for (let j = 0; j < NZ; j += 2) for (let i = 0; i < NX; i += 2) {
    const x = X0 + i * C, z = Z0 + j * C
    let edge = false
    for (let dj = 0; dj < 2 && !edge; dj++) for (let di = 0; di < 2 && !edge; di++) {
      const k = (j + dj) * NX + i + di
      if (i + di >= NX || j + dj >= NZ || roadCell[k] || hasFloor(k)) edge = true
    }
    for (let dz = 0.5; dz < 2 * C && !edge; dz += 2) for (let dx = 0.5; dx < 2 * C && !edge; dx += 2) if (floorAt(x + dx, z + dz)) edge = true
    if (!edge) { emit(x, z, 2 * C); continue }
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      const ii = i + di, jj = j + dj
      if (ii >= NX || jj >= NZ || roadCell[jj * NX + ii]) continue
      const cx = X0 + ii * C, cz = Z0 + jj * C
      // Fully inside existing floor (every metre of it): nothing to fill.
      let covered = true
      for (let ez = 0.5; ez < C && covered; ez++) for (let ex = 0.5; ex < C && covered; ex++) if (!floorAt(cx + ex, cz + ez)) covered = false
      if (!covered) emit(cx, cz, C)
    }
  }
  // Far LOD ground: 16 m cells, flat-coloured.
  for (let z = Z0; z < Z1; z += 16) for (let x = X0; x < X1; x += 16) {
    let fill = false
    for (let dz = 2; dz < 16 && !fill; dz += 4) for (let dx = 2; dx < 16 && !fill; dx += 4) if (!floorAt(x + dx, z + dz)) fill = true
    if (!fill) continue
    const y = (px, pz) => heightAt(px, pz) - 0.15
    quad(bucketFor(x + 8, z + 8).lod1.ground, [[x, y(x, z), z], [x + 16, y(x + 16, z), z], [x + 16, y(x + 16, z + 16), z + 16], [x, y(x, z + 16), z + 16]], null, TILES.pavement)
  }
}
log(`ground: ${groundTris.toLocaleString()} tris`)

// Buildings: lots on the blocks between streets (and between the outer streets and the edge),
// kept 12 m clear of existing scenery and 4 m of pavement back from the kerb.
let buildings = 0, buildTris = 0
function emitBuilding(x0, z0, x1, z1, height, style) {
  const b = bucketFor((x0 + x1) / 2, (z0 + z1) / 2)
  const base = Math.min(heightAt(x0, z0), heightAt(x1, z0), heightAt(x0, z1), heightAt(x1, z1)) - 0.5
  const top = Math.max(heightAt(x0, z0), heightAt(x1, z0), heightAt(x0, z1), heightAt(x1, z1)) + height
  const tile = TILES[style]
  // Walls, each split into 12 m tiles so the atlas repeats; each face runs clockwise seen from above, so it faces out.
  const faces = [[[x1, z1], [x0, z1]], [[x1, z0], [x1, z1]], [[x0, z0], [x1, z0]], [[x0, z1], [x0, z0]]]
  for (const [[ax, az], [bxp, bzp]] of faces) {
    const len = Math.hypot(bxp - ax, bzp - az)
    for (let s = 0; s < len - 0.01; s += 12) {
      const s1 = Math.min(len, s + 12)
      const pa = [ax + (bxp - ax) * s / len, az + (bzp - az) * s / len], pb = [ax + (bxp - ax) * s1 / len, az + (bzp - az) * s1 / len]
      for (let y = base; y < top - 0.01; y += 12) {
        const y1 = Math.min(top, y + 12)
        const p = [[pa[0], y, pa[1]], [pb[0], y, pb[1]], [pb[0], y1, pb[1]], [pa[0], y1, pa[1]]]
        // Floors are 4 m: a part tile at the top shows whole floors, from the bottom of the tile.
        quad(b.lod0.build, p, [[0, 1], [(s1 - s) / 12, 1], [(s1 - s) / 12, 1 - (y1 - y) / 12], [0, 1 - (y1 - y) / 12]], tile)
        buildTris += 2
      }
      const wall = [[pa[0], base, pa[1]], [pb[0], base, pb[1]], [pb[0], top, pb[1]], [pa[0], top, pa[1]]]
      colQuad(b.col.barrier, wall)
    }
    quad(b.lod1.build, [[ax, base, az], [bxp, base, bzp], [bxp, top, bzp], [ax, top, az]], null, tile)
  }
  const roof = [[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]]
  quad(b.lod0.build, roof, [[0, 0], [0, 1], [1, 1], [1, 0]], TILES.roof)
  quad(b.lod1.build, roof, null, TILES.roof)
  buildTris += 2
  buildings++
}
{
  const clear = new Uint8Array(NX * NZ) // 1 = a building may stand here
  const R = 3 // cells (12 m) of clearance from existing scenery
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
    let ok = true
    for (let dj = -R; dj <= R && ok; dj++) for (let di = -R; di <= R && ok; di++) {
      const ii = i + di, jj = j + dj
      if (ii < 0 || jj < 0 || ii >= NX || jj >= NZ) continue
      const k = jj * NX + ii
      if (occupied[k] || hasFloor(k)) ok = false
    }
    clear[j * NX + i] = ok ? 1 : 0
  }
  const freeRect = (x0, z0, x1, z1) => {
    for (let z = z0 + 1; z < z1; z += C) for (let x = x0 + 1; x < x1; x += C) { const k = cell(x, z); if (k < 0 || !clear[k] || roadCell[k] || !open[k]) return false }
    return true
  }
  // Block edges: the streets (kerb + 4 m pavement) and the edge of the fill area.
  const SIDE = 4
  const edgesX = [X0 - half - SIDE + 8, ...xs, X1 + half + SIDE - 8].sort((a, b) => a - b)
  const edgesZ = [Z0 - half - SIDE + 8, ...zs, Z1 + half + SIDE - 8].sort((a, b) => a - b)
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2, reach = Math.hypot(X1 - X0, Z1 - Z0) / 2
  for (let a = 0; a < edgesX.length - 1; a++) for (let c = 0; c < edgesZ.length - 1; c++) {
    const bx0 = edgesX[a] + half + SIDE, bx1 = edgesX[a + 1] - half - SIDE
    const bz0 = edgesZ[c] + half + SIDE, bz1 = edgesZ[c + 1] - half - SIDE
    if (bx1 - bx0 < 16 || bz1 - bz0 < 16) continue
    const nx = Math.max(1, Math.round((bx1 - bx0) / LOT)), nz = Math.max(1, Math.round((bz1 - bz0) / LOT))
    const lw = (bx1 - bx0) / nx, ld = (bz1 - bz0) / nz
    for (let u = 0; u < nx; u++) for (let v = 0; v < nz; v++) {
      // Only lots on the block's rim face a street; inner lots of a big block become courtyards.
      if (u > 0 && u < nx - 1 && v > 0 && v < nz - 1 && hash01(a, c, u, v, 11) < 0.6) continue
      const inset = 2 + hash01(a, c, u, v, 1) * 2
      const x0 = bx0 + u * lw + inset, x1 = bx0 + (u + 1) * lw - inset
      const z0 = bz0 + v * ld + inset, z1 = bz0 + (v + 1) * ld - inset
      if (x1 - x0 < 8 || z1 - z0 < 8 || !freeRect(x0, z0, x1, z1)) continue
      // Taller toward the edge: a skyline that walls the city in.
      const out = Math.min(1, Math.hypot((x0 + x1) / 2 - cx, (z0 + z1) / 2 - cz) / reach)
      const r = hash01(a, c, u, v, 2)
      const height = Math.round((H_MIN + (H_MAX - H_MIN) * (0.25 * r + 0.75 * r * r) * (0.55 + 0.45 * out)) / 4) * 4
      emitBuilding(x0, z0, x1, z1, height, FACADES[Math.floor(hash01(a, c, u, v, 3) * FACADES.length)])
    }
  }
}
log(`buildings: ${buildings} (${buildTris.toLocaleString()} tris)`)

// An invisible wall round the edge, so nobody drives off the end of the world.
{
  const corners = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]]
  for (let e = 0; e < 4; e++) {
    const [ax, az] = corners[e], [bx, bz] = corners[(e + 1) % 4]
    const len = Math.hypot(bx - ax, bz - az)
    for (let s = 0; s < len; s += 50) {
      const s1 = Math.min(len, s + 50)
      const pa = [ax + (bx - ax) * s / len, az + (bz - az) * s / len], pb = [ax + (bx - ax) * s1 / len, az + (bz - az) * s1 / len]
      const y0 = Math.min(heightAt(...pa), heightAt(...pb)) - 2, y1 = Math.max(heightAt(...pa), heightAt(...pb)) + 8
      colQuad(bucketFor((pa[0] + pb[0]) / 2 - Math.sign(bz - az) * 1, (pa[1] + pb[1]) / 2 + Math.sign(bx - ax) * 1).col.barrier, [[pa[0], y0, pa[1]], [pb[0], y0, pb[1]], [pb[0], y1, pb[1]], [pa[0], y1, pa[1]]])
    }
  }
}

// ── Existing buildings: tall prop components get their walls as barriers ───
const existingWalls = []
if (F.existingWalls !== false) {
  let added = 0, skipped = 0
  const barrierCells = new Uint8Array(NX * NZ)
  for (const m of collision) if (m.name.startsWith('barrier')) rasterize(m.pos, m.idx, (k) => { barrierCells[k] = 1 })
  for (const m of visual) {
    if (!m.name.startsWith('prop') && !m.name.startsWith('barrier')) continue
    // Connected components over welded positions.
    const n = m.pos.length / 3, parent = Int32Array.from({ length: n }, (_, i) => i)
    const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a }
    const key = new Map()
    for (let v = 0; v < n; v++) {
      const id = `${Math.round(m.pos[v * 3] * 20)},${Math.round(m.pos[v * 3 + 1] * 20)},${Math.round(m.pos[v * 3 + 2] * 20)}`
      const o = key.get(id)
      if (o === undefined) key.set(id, v); else parent[find(v)] = find(o)
    }
    for (let t = 0; t < m.idx.length; t += 3) { const a = find(m.idx[t]); parent[find(m.idx[t + 1])] = a; parent[find(m.idx[t + 2])] = a }
    const comps = new Map()
    for (let t = 0; t < m.idx.length; t += 3) {
      const r = find(m.idx[t])
      let c = comps.get(r)
      if (!c) comps.set(r, (c = { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }))
      c.tris.push(t)
      for (let k = 0; k < 3; k++) { const v = m.idx[t + k] * 3; for (let a = 0; a < 3; a++) { c.min[a] = Math.min(c.min[a], m.pos[v + a]); c.max[a] = Math.max(c.max[a], m.pos[v + a]) } }
    }
    for (const c of comps.values()) {
      const dx = c.max[0] - c.min[0], dy = c.max[1] - c.min[1], dz = c.max[2] - c.min[2]
      // A building: tall, and big in plan. Poles, signs, lamps and fences don't pass.
      if (dy < 5 || Math.max(dx, dz) < 8 || Math.min(dx, dz) < 3) continue
      // Already collides (its walls are barriers in the build): leave it.
      const k = cell((c.min[0] + c.max[0]) / 2, (c.min[2] + c.max[2]) / 2)
      let covered = 0, total = 0
      for (let z = c.min[2] + 1; z < c.max[2]; z += C) for (let x = c.min[0] + 1; x < c.max[0]; x += C) { const kk = cell(x, z); if (kk < 0) continue; total++; if (barrierCells[kk]) covered++ }
      if (k >= 0 && total && covered / total > 0.3) { skipped++; continue }
      for (const t of c.tris) {
        const a = m.idx[t] * 3, b = m.idx[t + 1] * 3, d = m.idx[t + 2] * 3
        const ux = m.pos[b] - m.pos[a], uy = m.pos[b + 1] - m.pos[a + 1], uz = m.pos[b + 2] - m.pos[a + 2]
        const vx = m.pos[d] - m.pos[a], vy = m.pos[d + 1] - m.pos[a + 1], vz = m.pos[d + 2] - m.pos[a + 2]
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
        const l = Math.hypot(nx, ny, nz)
        // Walls only (roofs and awnings would be a ceiling, not a wall).
        if (l < 1e-6 || Math.abs(ny / l) > 0.5) continue
        // Below 0.3 m it's a kerb or a step the car should still roll over.
        if (Math.max(m.pos[a + 1], m.pos[b + 1], m.pos[d + 1]) < c.min[1] + 0.3) continue
        existingWalls.push(m.pos[a], m.pos[a + 1], m.pos[a + 2], m.pos[b], m.pos[b + 1], m.pos[b + 2], m.pos[d], m.pos[d + 1], m.pos[d + 2])
      }
      added++
    }
  }
  log(`existing buildings given wall collision: ${added} (already colliding: ${skipped}), ${(existingWalls.length / 9).toLocaleString()} wall tris`)
}

// ── Write ───────────────────────────────────────────────────────────────────
function newDoc() {
  const doc = new Document().setLogger(new Logger(Logger.Verbosity.ERROR))
  doc.createBuffer()
  doc.createScene('scene')
  return doc
}
function addMesh(doc, name, g, mat) {
  const buf = doc.getRoot().listBuffers()[0]
  const pos = Float32Array.from(g.pos)
  const idx = pos.length / 3 <= 65535 ? Uint16Array.from(g.idx) : Uint32Array.from(g.idx)
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf))
  if (g.uv?.length) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(Float32Array.from(g.uv)).setBuffer(buf))
  if (g.color?.length) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(Float32Array.from(g.color)).setBuffer(buf))
  if (g.nrm) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(g.nrm).setBuffer(buf))
  if (mat) prim.setMaterial(doc.getRoot().listMaterials().find((m) => m.getName() === mat) ?? doc.createMaterial(mat))
  doc.getRoot().listScenes()[0].addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)))
}
/** Flat-shaded normals: every quad here has its own four vertices. */
function withNormals(g) {
  const nrm = new Float32Array(g.pos.length)
  for (let t = 0; t < g.idx.length; t += 3) {
    const a = g.idx[t] * 3, b = g.idx[t + 1] * 3, c = g.idx[t + 2] * 3
    const ux = g.pos[b] - g.pos[a], uy = g.pos[b + 1] - g.pos[a + 1], uz = g.pos[b + 2] - g.pos[a + 2]
    const vx = g.pos[c] - g.pos[a], vy = g.pos[c + 1] - g.pos[a + 1], vz = g.pos[c + 2] - g.pos[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    for (const v of [a, b, c]) { nrm[v] += nx; nrm[v + 1] += ny; nrm[v + 2] += nz }
  }
  for (let v = 0; v < nrm.length; v += 3) { const l = Math.hypot(nrm[v], nrm[v + 1], nrm[v + 2]) || 1; nrm[v] /= l; nrm[v + 1] /= l; nrm[v + 2] /= l }
  return { ...g, nrm }
}
async function writeDoc(doc, rel, quantizePosition = 14) {
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizePosition }))
  const bytes = await io.writeBinary(doc)
  await fs.writeFile(path.join(outDir, rel), bytes)
  return bytes.byteLength
}
/** Collision floors are mostly flat: weld and simplify (positions only) before shipping. */
function simplifyCollision(g, error) {
  const map = new Map(), pos = [], remap = []
  for (let v = 0; v < g.pos.length / 3; v++) {
    const id = `${Math.round(g.pos[v * 3] * 100)},${Math.round(g.pos[v * 3 + 1] * 100)},${Math.round(g.pos[v * 3 + 2] * 100)}`
    let n = map.get(id)
    if (n === undefined) { n = pos.length / 3; map.set(id, n); pos.push(g.pos[v * 3], g.pos[v * 3 + 1], g.pos[v * 3 + 2]) }
    remap.push(n)
  }
  const idx = Uint32Array.from(g.idx, (i) => remap[i])
  const p = Float32Array.from(pos)
  const [out] = MeshoptSimplifier.simplify(idx, p, 3, 0, error, ['ErrorAbsolute', 'LockBorder'])
  return { pos: p, idx: out.length ? out : idx }
}

for (const old of await fs.readdir(path.join(outDir, 'chunks'))) if (old.startsWith('f_')) await fs.rm(path.join(outDir, 'chunks', old))
const fillChunks = []
const colDoc = newDoc()
for (const m of collision) addMesh(colDoc, m.name, { pos: m.pos, idx: m.idx }, null)
let bytes0 = 0, bytes1 = 0, tris0 = 0, tris1 = 0
for (const b of [...buckets.values()].sort((p, q) => p.i - q.i || p.j - q.j)) {
  const entry = { id: b.id, i: b.i, j: b.j, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], lods: [] }
  for (const lod of [0, 1]) {
    const parts = b[`lod${lod}`]
    const doc = newDoc()
    let tris = 0
    for (const [layer, g] of [['road', parts.ground], ['prop', parts.build]]) {
      if (!g.idx.length) continue
      for (let v = 0; v < g.pos.length; v += 3) for (let k = 0; k < 3; k++) { entry.min[k] = Math.min(entry.min[k], g.pos[v + k]); entry.max[k] = Math.max(entry.max[k], g.pos[v + k]) }
      addMesh(doc, lod === 0 ? `${layer}__${MAT}` : `${layer}__lod1`, withNormals(g), lod === 0 ? MAT : '__vertex_color')
      tris += g.idx.length / 3
    }
    if (!tris) continue
    const rel = `chunks/${b.id}_lod${lod}.glb`
    const n = await writeDoc(doc, rel)
    entry.lods.push({ url: rel, bytes: n, tris })
    if (lod === 0) { bytes0 += n; tris0 += tris } else { bytes1 += n; tris1 += tris }
  }
  if (entry.lods.length === 2) {
    entry.min = entry.min.map((v) => Math.round(v * 100) / 100)
    entry.max = entry.max.map((v) => Math.round(v * 100) / 100)
    fillChunks.push(entry)
  }
  if (b.col.ground.idx.length) addMesh(colDoc, `ground__fill_${b.id}`, simplifyCollision(b.col.ground, 0.03), null)
  if (b.col.road.idx.length) addMesh(colDoc, `road__fill_${b.id}`, simplifyCollision(b.col.road, 0.02), null)
  if (b.col.barrier.idx.length) addMesh(colDoc, `barrier__fill_${b.id}`, { pos: Float32Array.from(b.col.barrier.pos), idx: Uint32Array.from(b.col.barrier.idx) }, null)
}
if (existingWalls.length) {
  // One node per 200 m chunk, like the build's own barriers.
  const per = new Map()
  for (let t = 0; t < existingWalls.length; t += 9) {
    const id = `${Math.floor((existingWalls[t] + existingWalls[t + 3] + existingWalls[t + 6]) / 3 / S)}_${Math.floor((existingWalls[t + 2] + existingWalls[t + 5] + existingWalls[t + 8]) / 3 / S)}`
    let g = per.get(id)
    if (!g) per.set(id, (g = { pos: [], idx: [] }))
    const base = g.pos.length / 3
    for (let k = 0; k < 9; k++) g.pos.push(existingWalls[t + k])
    g.idx.push(base, base + 1, base + 2)
  }
  for (const [id, g] of per) addMesh(colDoc, `barrier__fillwalls_${id}`, simplifyCollision(g, 0.05), null)
}
// 16-bit positions, as the build writes collision.
const colBytes = await writeDoc(colDoc, manifest.collision, 16)
log(`fill chunks: ${fillChunks.length}, lod0 ${tris0.toLocaleString()} tris / ${(bytes0 / 1e6).toFixed(2)} MB, lod1 ${tris1.toLocaleString()} tris / ${(bytes1 / 1e6).toFixed(2)} MB; collision ${(colBytes / 1e6).toFixed(2)} MB`)

// Materials: the atlas into both libraries (replacing an earlier run's).
const png = await sharp(atlas, { raw: { width: AW, height: AH, channels: 3 } }).png().toBuffer()
for (const [tier, width] of [['high', AW], ['low', AW / 2]]) {
  const file = path.join(outDir, manifest.materials[tier])
  const doc = await io.read(file)
  for (const m of doc.getRoot().listMaterials()) if (m.getName() === MAT) { m.getBaseColorTexture()?.dispose(); m.dispose() }
  const image = await sharp(png).resize(width, width / 2).webp({ quality: 85 }).toBuffer()
  const tex = doc.createTexture(MAT).setImage(new Uint8Array(image)).setMimeType('image/webp')
  doc.createMaterial(MAT).setBaseColorTexture(tex).setMetallicFactor(0).setRoughnessFactor(0.85).setExtras({ layer: 'road' })
  // The library is already compressed; keep its encoding.
  await fs.writeFile(file, await io.writeBinary(doc))
  log(`materials_${tier}: + ${MAT} (${(image.byteLength / 1e3).toFixed(0)} KB)`)
}

manifest.chunks = [...baseChunks, ...fillChunks]
manifest.stats.lod0Tris = baseChunks.reduce((s, c) => s + c.lods[0].tris, 0) + tris0
manifest.stats.lod1Tris = baseChunks.reduce((s, c) => s + (c.lods[1]?.tris ?? 0), 0) + tris1
manifest.stats.bytes.collision = colBytes
manifest.cityFill = { bounds: [X0, Z0, X1, Z1], buildings, streets: xs.length + zs.length }
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 1))
log('wrote', path.relative(process.cwd(), manifestPath))
