// Debug: a top-down map of a BUILT track (its shipped LOD0 chunks, no source GLB needed) for
// planning a route: drivable surfaces grey (the config's lineSurface lanes lighter), the current
// route red, gates numbered, a labelled 100 m grid in runtime coordinates (metres from the start
// line, X right, Z down). HEIGHT=1 colours drivable surfaces by height instead (blue low, red
// high), so bridges and ramps show.
//
//   node scripts/track/route-map.mjs scripts/track/paris.config.mjs out.png [pxPerMeter]
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const [configPath, output, pxArg] = process.argv.slice(2)
if (!configPath || !output) throw new Error('usage: route-map.mjs <config.mjs> <out.png> [pxPerMeter]')
const cfg = (await import(pathToFileURL(path.resolve(configPath)).href)).default
const outDir = path.resolve(cfg.out)
const manifest = JSON.parse(await fs.readFile(path.join(outDir, 'track.json'), 'utf8'))
const px = Number(pxArg ?? 0.5)

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })

const tris = [] // [ax, az, bx, bz, cx, cz, shade, y]
const byHeight = process.env.HEIGHT === '1'
let y0 = Infinity, y1 = -Infinity
let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
for (const c of manifest.chunks) {
  const doc = await io.read(path.join(outDir, c.lods[0].url))
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh()
    if (!mesh) continue
    const [layer] = node.getName().split('__')
    if (layer !== 'road' && layer !== 'barrier') continue
    const m = node.getWorldMatrix()
    for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()?.getName() ?? ''
      const shade = layer === 'barrier' ? 3 : cfg.lineSurface?.test(mat) ? 2 : 1
      const acc = prim.getAttribute('POSITION'), idx = prim.getIndices().getArray()
      const e = [0, 0, 0], p = [], ys = []
      for (let i = 0; i < acc.getCount(); i++) {
        acc.getElement(i, e)
        const x = m[0] * e[0] + m[4] * e[1] + m[8] * e[2] + m[12], z = m[2] * e[0] + m[6] * e[1] + m[10] * e[2] + m[14]
        p.push(x, z)
        const y = m[1] * e[0] + m[5] * e[1] + m[9] * e[2] + m[13]
        ys.push(y)
        if (layer === 'road') { y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
      }
      for (let t = 0; t < idx.length; t += 3) tris.push([p[idx[t] * 2], p[idx[t] * 2 + 1], p[idx[t + 1] * 2], p[idx[t + 1] * 2 + 1], p[idx[t + 2] * 2], p[idx[t + 2] * 2 + 1], shade, (ys[idx[t]] + ys[idx[t + 1]] + ys[idx[t + 2]]) / 3])
    }
  }
}
x0 -= 40; z0 -= 40; x1 += 40; z1 += 40
const W = Math.ceil((x1 - x0) * px), H = Math.ceil((z1 - z0) * px)
const img = Buffer.alloc(W * H * 3, 18)
const COLORS = { 1: [95, 95, 100], 2: [175, 175, 180], 3: [60, 110, 160] }
const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) { const o = (y * W + x) * 3; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2] } }
// Roads first, barriers on top.
const heightColor = (y) => {
  const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0 || 1)))
  return [Math.round(40 + 215 * t), Math.round(120 + 80 * Math.sin(Math.PI * t)), Math.round(255 - 215 * t)]
}
// Low to high, so a bridge draws over the street under it.
if (byHeight) tris.sort((a, b) => (a[6] === 3) - (b[6] === 3) || a[7] - b[7])
for (const pass of byHeight ? [0] : [1, 2, 3]) for (const [ax, az, bx, bz, cx, cz, s, ty] of tris) {
  if (!byHeight && s !== pass) continue
  const color = byHeight ? (s === 3 ? COLORS[3] : heightColor(ty)) : COLORS[s]
  const X = [(ax - x0) * px, (bx - x0) * px, (cx - x0) * px], Z = [(az - z0) * px, (bz - z0) * px, (cz - z0) * px]
  const minx = Math.max(0, Math.floor(Math.min(...X))), maxx = Math.min(W - 1, Math.ceil(Math.max(...X)))
  const minz = Math.max(0, Math.floor(Math.min(...Z))), maxz = Math.min(H - 1, Math.ceil(Math.max(...Z)))
  const d = (X[1] - X[0]) * (Z[2] - Z[0]) - (X[2] - X[0]) * (Z[1] - Z[0])
  if (Math.abs(d) < 1e-9) continue
  for (let y = minz; y <= maxz; y++) for (let x = minx; x <= maxx; x++) {
    const u = ((X[1] - x) * (Z[2] - y) - (X[2] - x) * (Z[1] - y)) / d
    const v = ((X[2] - x) * (Z[0] - y) - (X[0] - x) * (Z[2] - y)) / d
    if (u >= 0 && v >= 0 && u + v <= 1) put(x, y, color)
  }
}
// Grid every 100 m.
for (let gx = Math.ceil(x0 / 100) * 100; gx < x1; gx += 100) for (let y = 0; y < H; y++) if (y % 3 === 0) put(Math.round((gx - x0) * px), y, gx === 0 ? [90, 200, 90] : [50, 70, 50])
for (let gz = Math.ceil(z0 / 100) * 100; gz < z1; gz += 100) for (let x = 0; x < W; x++) if (x % 3 === 0) put(x, Math.round((gz - z0) * px), gz === 0 ? [90, 200, 90] : [50, 70, 50])
// Route.
const line = manifest.line
for (let i = 0; i < line.length; i++) {
  const a = line[i], b = line[(i + 1) % line.length]
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) * px * 2) + 1
  for (let k = 0; k <= n; k++) {
    const x = Math.round(((a[0] + (b[0] - a[0]) * k / n) - x0) * px), y = Math.round(((a[2] + (b[2] - a[2]) * k / n) - z0) * px)
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(x + dx, y + dy, [230, 50, 50])
  }
}
// Labels as SVG overlay: grid values and gate numbers.
const labels = []
for (let gx = Math.ceil(x0 / 100) * 100; gx < x1; gx += 100) labels.push(`<text x="${(gx - x0) * px + 2}" y="12" fill="#9c9" font-size="11">${gx}</text>`)
for (let gz = Math.ceil(z0 / 100) * 100; gz < z1; gz += 100) labels.push(`<text x="2" y="${(gz - z0) * px - 2}" fill="#9c9" font-size="11">${gz}</text>`)
manifest.checkpoints.forEach((g, i) => {
  const x = (g.position[0] - x0) * px, y = (g.position[2] - z0) * px
  labels.push(`<circle cx="${x}" cy="${y}" r="7" fill="#ffd400"/><text x="${x - 4}" y="${y + 4}" font-size="11" font-weight="bold" fill="#000">${i}</text>`)
})
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels.join('')}</svg>`)
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: svg }]).png().toFile(output)
if (byHeight) console.log(`heights ${y0.toFixed(1)}..${y1.toFixed(1)} m (blue..red)`)
console.log(`${output}: ${W}x${H}, x ${Math.round(x0)}..${Math.round(x1)}, z ${Math.round(z0)}..${Math.round(z1)}, route ${Math.round(manifest.lineLength)} m, ${manifest.checkpoints.length} gates`)
