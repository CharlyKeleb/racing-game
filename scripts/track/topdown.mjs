// Debug: rasterises selected materials top-down (X right, Z down) with a labelled
// 100 m grid, so we can pick spawn / checkpoints by eye.
// usage: node topdown.mjs <in.glb> <out.png> <materialRegex> [minX minZ maxX maxZ] [pxPerMeter]
// SCALE=<n> scales the source like a track config's `scale`.
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import sharp from 'sharp'

const [input, output, matRe, ...rest] = process.argv.slice(2)
const re = new RegExp(matRe)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(input)

const tris = [] // [ax,az,bx,bz,cx,cz,colorIdx]
const mats = []
const v = [0, 0, 0]
const scale = Number(process.env.SCALE ?? 1)
const apply = (m, x, y, z) => {
  v[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) * scale
  v[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) * scale
  v[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) * scale
  return v
}
let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  const m = node.getWorldMatrix()
  for (const prim of mesh.listPrimitives()) {
    const name = prim.getMaterial()?.getName() ?? ''
    if (!re.test(name)) continue
    let ci = mats.indexOf(name)
    if (ci < 0) ci = mats.push(name) - 1
    const pos = prim.getAttribute('POSITION').getArray()
    const idx = prim.getIndices()?.getArray()
    const n = idx ? idx.length : pos.length / 3
    for (let i = 0; i < n; i += 3) {
      const t = []
      for (let k = 0; k < 3; k++) {
        const j = (idx ? idx[i + k] : i + k) * 3
        const p = apply(m, pos[j], pos[j + 1], pos[j + 2])
        t.push(p[0], p[2])
        minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2])
      }
      t.push(ci)
      tris.push(t)
    }
  }
}
if (rest.length >= 4) [minX, minZ, maxX, maxZ] = rest.slice(0, 4).map(Number)
const ppm = Number(rest[4] ?? 1)
const W = Math.ceil((maxX - minX) * ppm), H = Math.ceil((maxZ - minZ) * ppm)
const img = Buffer.alloc(W * H * 3, 20)
const palette = [[200, 200, 200], [255, 120, 0], [80, 160, 255], [255, 60, 60], [80, 220, 120], [220, 220, 60], [200, 80, 220], [60, 220, 220]]
for (const [ax, az, bx, bz, cx, cz, ci] of tris) {
  const pts = [[ax, az], [bx, bz], [cx, cz]].map(([x, z]) => [(x - minX) * ppm, (z - minZ) * ppm])
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[0])))), x1 = Math.min(W - 1, Math.ceil(Math.max(...pts.map((p) => p[0]))))
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((p) => p[1])))), y1 = Math.min(H - 1, Math.ceil(Math.max(...pts.map((p) => p[1]))))
  const [[px, py], [qx, qy], [rx, ry]] = pts
  const area = (qx - px) * (ry - py) - (qy - py) * (rx - px)
  if (area === 0) continue
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const sx = x + 0.5, sy = y + 0.5
      const w0 = ((qx - sx) * (ry - sy) - (qy - sy) * (rx - sx)) / area
      const w1 = ((rx - sx) * (py - sy) - (ry - sy) * (px - sx)) / area
      const w2 = 1 - w0 - w1
      if (w0 < 0 || w1 < 0 || w2 < 0) continue
      const o = (y * W + x) * 3, c = palette[ci % palette.length]
      img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]
    }
}
let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`
const step = 100
for (let gx = Math.ceil(minX / step) * step; gx <= maxX; gx += step) {
  const x = (gx - minX) * ppm
  svg += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#555" stroke-width="1"/><text x="${x + 2}" y="12" fill="#ff0" font-size="11">${gx}</text>`
}
for (let gz = Math.ceil(minZ / step) * step; gz <= maxZ; gz += step) {
  const y = (gz - minZ) * ppm
  svg += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#555" stroke-width="1"/><text x="2" y="${y - 2}" fill="#0ff" font-size="11">${gz}</text>`
}
if (process.env.LINE) {
  const fs = await import('node:fs')
  const pts = JSON.parse(fs.readFileSync(process.env.LINE, 'utf8')).map(([x, z]) => `${((x - minX) * ppm).toFixed(1)},${((z - minZ) * ppm).toFixed(1)}`)
  svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="#ffb000" stroke-width="3"/>`
}
if (process.env.MARKERS) {
  const fs = await import('node:fs')
  for (const [n, g] of JSON.parse(fs.readFileSync(process.env.MARKERS, 'utf8')).entries()) {
    const x = (g.at[0] - minX) * ppm, y = (g.at[1] - minZ) * ppm
    svg += `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="#fff" stroke-width="2"/><line x1="${x}" y1="${y}" x2="${x + g.dir[0] * 25}" y2="${y + g.dir[1] * 25}" stroke="#fff" stroke-width="2"/><text x="${x + 8}" y="${y - 8}" fill="#fff" font-size="16" font-weight="bold">${n}</text>`
  }
}
mats.forEach((m, i) => (svg += `<text x="${W - 260}" y="${20 + i * 14}" fill="rgb(${palette[i % palette.length]})" font-size="13">${m}</text>`))
svg += '</svg>'
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(output)
console.log(`${W}x${H} bounds x[${minX.toFixed(0)},${maxX.toFixed(0)}] z[${minZ.toFixed(0)},${maxZ.toFixed(0)}] tris=${tris.length}`, mats)
