// Turns the NFS 2015 garage (Sketchfab, baked lighting) into a web-ready showroom.
//
//   node scripts/garage/build-garage.mjs [source.glb]
//
// Output (public/models/garage/):
//   garage_high.glb   textures ≤ 2048, WebP     ┐ unlit (KHR_materials_unlit): the lighting is
//   garage_low.glb    textures ≤ 1024, WebP     ┘ baked into the textures, so it costs no lights
//   garage.json       wall clearance around the car spot (camera collision), ceiling, stats
//
// The source is modelled at 1/10 scale with its own origin. We bake in metres,
// put the floor at y = 0 and the origin on the most open patch of floor (found
// by probing, see SPOT), and turn the room so the lit workshop bay sits behind
// the car in the menu's opening camera angle.
import { Document, Logger, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from '@gltf-transform/extensions'
import { meshopt, textureCompress } from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const SOURCE = process.argv[2] ?? `${process.env.HOME}/Downloads/garage_nfs_2015.glb`
const OUT = 'public/models/garage'
/** Source units → metres. The room comes out 17 m wide, 24 m deep, 6.3 m to the trusses. */
const SCALE = 10
/** Search area for the car spot, scaled source XZ: [minX, minZ, maxX, maxZ], step (m). */
const SPOT_SEARCH = { box: [-7, -10, 7, 8], step: 0.5 }
/** Rays per probe: dense enough that a thin pole can't slip between two. */
const PROBE_RAYS = 256
/**
 * The menu camera's resting yaw in the car's frame (Game.showroomYaw starts here:
 * a front three-quarter view). The room is turned so the most open arc of floor
 * lines up with it.
 */
const HERO_YAW = 0.9
/** Half-width of the arc the idle camera sways through, in probe rays (256 per turn → ±50°). */
const ARC_RAYS = 36
/** Clearance beyond this doesn't make a spot better (the camera sits at 7.5 m). */
const ENOUGH = 9
/** Glow sprite sheets: drawn additive at runtime. */
const GLOW = /^Lights_D$/
const TIERS = { high: 2048, low: 1024 }

await MeshoptEncoder.ready
const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.ERROR)).registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
const src = await io.read(SOURCE)

// ── Bake every primitive to metres in source world space ───────────────────
const parts = [] // { mat, pos, nrm, uv, idx }
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const p = prim.getAttribute('POSITION').getArray()
    const n = prim.getAttribute('NORMAL')?.getArray()
    const count = p.length / 3
    const pos = new Float32Array(count * 3)
    const nrm = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2]
      pos[i * 3] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * SCALE
      pos[i * 3 + 1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * SCALE
      pos[i * 3 + 2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * SCALE
      if (n) {
        const a = n[i * 3], b = n[i * 3 + 1], c = n[i * 3 + 2]
        const nx = m[0] * a + m[4] * b + m[8] * c, ny = m[1] * a + m[5] * b + m[9] * c, nz = m[2] * a + m[6] * b + m[10] * c
        const l = Math.hypot(nx, ny, nz) || 1
        nrm[i * 3] = nx / l; nrm[i * 3 + 1] = ny / l; nrm[i * 3 + 2] = nz / l
      }
    }
    const idxAcc = prim.getIndices()
    parts.push({
      mat: prim.getMaterial(),
      pos,
      nrm,
      uv: Float32Array.from(prim.getAttribute('TEXCOORD_0').getArray()),
      idx: idxAcc ? Uint32Array.from(idxAcc.getArray()) : Uint32Array.from({ length: count }, (_, i) => i),
    })
  }
}

// ── Ray casting (Möller–Trumbore) for floor height and wall clearance ──────
function cast(ox, oy, oz, dx, dy, dz, filter) {
  let best = Infinity
  for (const part of parts) {
    if (!filter(part.mat.getName())) continue
    const { pos, idx } = part
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3
      const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2]
      const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2]
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x
      const det = e1x * px + e1y * py + e1z * pz
      if (Math.abs(det) < 1e-9) continue
      const inv = 1 / det
      const tx = ox - pos[a], ty = oy - pos[a + 1], tz = oz - pos[a + 2]
      const u = (tx * px + ty * py + tz * pz) * inv
      if (u < 0 || u > 1) continue
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
      const v = (dx * qx + dy * qy + dz * qz) * inv
      if (v < 0 || u + v > 1) continue
      const d = (e2x * qx + e2y * qy + e2z * qz) * inv
      if (d > 1e-4 && d < best) best = d
    }
  }
  return best
}

const solid = (name) => !GLOW.test(name)

/**
 * Horizontal clearance from (x, h, z) in `rays` directions, testing only the
 * triangles that straddle height h (a horizontal ray can't hit anything else),
 * which makes a whole-floor search fast.
 */
function bandOf(h) {
  const tris = []
  for (const part of parts) {
    if (!solid(part.mat.getName())) continue
    const { pos, idx } = part
    for (let t = 0; t < idx.length; t += 3) {
      const ya = pos[idx[t] * 3 + 1], yb = pos[idx[t + 1] * 3 + 1], yc = pos[idx[t + 2] * 3 + 1]
      if (Math.min(ya, yb, yc) <= h && Math.max(ya, yb, yc) >= h) tris.push(idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3, parts.indexOf(part))
    }
  }
  return tris
}
function horizontalClearance(band, x, h, z, rays) {
  const out = new Float32Array(rays).fill(Infinity)
  for (let r = 0; r < rays; r++) {
    const a = (r / rays) * Math.PI * 2
    const dx = Math.sin(a), dz = Math.cos(a)
    for (let t = 0; t < band.length; t += 4) {
      const pos = parts[band[t + 3]].pos
      const A = band[t], B = band[t + 1], Cc = band[t + 2]
      const e1x = pos[B] - pos[A], e1y = pos[B + 1] - pos[A + 1], e1z = pos[B + 2] - pos[A + 2]
      const e2x = pos[Cc] - pos[A], e2y = pos[Cc + 1] - pos[A + 1], e2z = pos[Cc + 2] - pos[A + 2]
      const px = -dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y
      const det = e1x * px + e1y * py + e1z * pz
      if (Math.abs(det) < 1e-9) continue
      const inv = 1 / det
      const tx = x - pos[A], ty = h - pos[A + 1], tz = z - pos[A + 2]
      const u = (tx * px + ty * py + tz * pz) * inv
      if (u < 0 || u > 1) continue
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x
      const v = (dx * qx + dz * qz) * inv
      if (v < 0 || u + v > 1) continue
      const d = (e2x * qx + e2y * qy + e2z * qz) * inv
      if (d > 1e-4 && d < out[r]) out[r] = d
    }
  }
  return out
}

// ── Find the car spot and hero direction ───────────────────────────────────
// For every floor point, probe 256 directions at bonnet height (0.9 m) and
// camera height (1.6 m) so low clutter and thin poles both count, then find the
// ±50° arc with the most room: the idle camera sways there. Clutter outside the
// arc is fine — it's the workshop backdrop.
function bestArc(c0, c1) {
  const n = c0.length
  const d = Array.from({ length: n }, (_, i) => Math.min(c0[i], c1[i], ENOUGH))
  let best = { score: -Infinity, center: 0, min: 0 }
  for (let c = 0; c < n; c++) {
    let sum = 0, min = Infinity
    for (let k = -ARC_RAYS; k <= ARC_RAYS; k++) {
      const v = d[(c + k + n) % n]
      sum += v
      min = Math.min(min, v)
    }
    const score = sum / (2 * ARC_RAYS + 1) + min
    if (score > best.score) best = { score, center: c, min }
  }
  return best
}
const roughFloor = 50 - cast(0, 50, 0, 0, -1, 0, (n) => n === 'Ground')
const bands = [bandOf(roughFloor + 0.9), bandOf(roughFloor + 1.6)]
let SPOT = null
let bestScore = -Infinity
for (let x = SPOT_SEARCH.box[0]; x <= SPOT_SEARCH.box[2]; x += SPOT_SEARCH.step) {
  for (let z = SPOT_SEARCH.box[1]; z <= SPOT_SEARCH.box[3]; z += SPOT_SEARCH.step) {
    const f = cast(x, 50, z, 0, -1, 0, (n) => n === 'Ground')
    if (!Number.isFinite(f) || Math.abs(50 - f - roughFloor) > 0.15) continue // off the main floor
    const c0 = horizontalClearance(bands[0], x, roughFloor + 0.9, z, PROBE_RAYS)
    const c1 = horizontalClearance(bands[1], x, roughFloor + 1.6, z, PROBE_RAYS)
    // The car itself needs ~3 m around it so the turntable never clips the body.
    let near = Infinity
    for (let r = 0; r < PROBE_RAYS; r++) near = Math.min(near, c0[r], c1[r])
    if (near < 3) continue
    const arc = bestArc(c0, c1)
    if (arc.score > bestScore) { bestScore = arc.score; SPOT = [x, z, arc.min, (arc.center / PROBE_RAYS) * Math.PI * 2] }
  }
}
console.log(`car spot ${SPOT[0]}, ${SPOT[1]}: hero arc min clearance ${SPOT[2].toFixed(2)} m`)
// Rotating by YAW maps direction angle a → a + YAW: put the hero arc on HERO_YAW.
const YAW_RAD = HERO_YAW - SPOT[3]
const floorHit = cast(SPOT[0], 50, SPOT[1], 0, -1, 0, (n) => n === 'Ground')
if (!Number.isFinite(floorHit)) throw new Error('no floor under SPOT')
const floorY = 50 - floorHit

// ── Centre on the spot, floor at 0, turn the room ──────────────────────────
const yaw = YAW_RAD
const cs = Math.cos(yaw), sn = Math.sin(yaw)
for (const part of parts) {
  const { pos, nrm } = part
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] - SPOT[0], z = pos[i + 2] - SPOT[1]
    pos[i] = x * cs + z * sn
    pos[i + 1] -= floorY
    pos[i + 2] = -x * sn + z * cs
    const nx = nrm[i], nz = nrm[i + 2]
    nrm[i] = nx * cs + nz * sn
    nrm[i + 2] = -nx * sn + nz * cs
  }
}

// Clearance in the car's frame: direction k is (sin a, cos a), a = k/32 · 2π — the
// same convention as ChaseCamera.showroom's yaw. Measured at camera height.
// The minimum over each 1/32 sector at two heights, so a pole between samples still counts.
const fine = [bandOf(0.9), bandOf(1.6)].map((band, i) => horizontalClearance(band, 0, i ? 1.6 : 0.9, 0, 32 * 8))
const clearance = Array.from({ length: 32 }, (_, k) => {
  let d = Infinity
  for (let j = -4; j <= 4; j++) {
    const r = (k * 8 + j + 256) % 256
    d = Math.min(d, fine[0][r], fine[1][r])
  }
  return Math.round(Math.min(d, 40) * 100) / 100
})
const ceiling = Math.round(cast(0, 0.5, 0, 0, 1, 0, solid) * 100 + 50) / 100
console.log(`floor ${floorY.toFixed(3)} m, min clearance ${Math.min(...clearance)} m, ceiling ${ceiling} m`)

// ── Write one mesh per material ─────────────────────────────────────────────
async function writeTier(tier, maxSize) {
  const doc = new Document()
  const buf = doc.createBuffer()
  const scene = doc.createScene('garage')
  const unlit = doc.createExtension(KHRMaterialsUnlit)
  const byMat = new Map()
  for (const part of parts) {
    const list = byMat.get(part.mat) ?? []
    list.push(part)
    byMat.set(part.mat, list)
  }
  let tris = 0
  for (const [srcMat, list] of byMat) {
    const name = srcMat.getName()
    const vCount = list.reduce((s, p) => s + p.pos.length / 3, 0)
    const iCount = list.reduce((s, p) => s + p.idx.length, 0)
    const pos = new Float32Array(vCount * 3), nrm = new Float32Array(vCount * 3), uv = new Float32Array(vCount * 2), idx = new Uint32Array(iCount)
    let v = 0, o = 0
    for (const p of list) {
      pos.set(p.pos, v * 3); nrm.set(p.nrm, v * 3); uv.set(p.uv, v * 2)
      for (const i of p.idx) idx[o++] = i + v
      v += p.pos.length / 3
    }
    tris += iCount / 3
    const tex = srcMat.getBaseColorTexture()
    const mat = doc.createMaterial(name).setBaseColorFactor(srcMat.getBaseColorFactor()).setExtension('KHR_materials_unlit', unlit.createUnlit())
    if (GLOW.test(name)) mat.setExtras({ glow: true })
    if (tex) mat.setBaseColorTexture(doc.createTexture(name).setImage(tex.getImage()).setMimeType(tex.getMimeType()))
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nrm).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uv).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(vCount <= 65535 ? Uint16Array.from(idx) : idx).setBuffer(buf))
      .setMaterial(mat)
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)))
  }
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [maxSize, maxSize], quality: 85 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  const bytes = await io.writeBinary(doc)
  await fs.writeFile(path.join(OUT, `garage_${tier}.glb`), bytes)
  console.log(`garage_${tier}.glb ${(bytes.byteLength / 1e6).toFixed(2)} MB, ${tris} tris`)
  return { bytes: bytes.byteLength, tris }
}

await fs.mkdir(OUT, { recursive: true })
const stats = { high: await writeTier('high', TIERS.high), low: await writeTier('low', TIERS.low) }
await fs.writeFile(
  path.join(OUT, 'garage.json'),
  JSON.stringify({ version: 1, models: { high: 'garage_high.glb', low: 'garage_low.glb' }, clearance, ceiling, heroYaw: HERO_YAW, heroArc: (ARC_RAYS / PROBE_RAYS) * Math.PI * 2, stats }, null, 1),
)
console.log('wrote', OUT)
