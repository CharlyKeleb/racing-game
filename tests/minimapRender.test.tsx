import { it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { decodeSurfaceRle, SurfaceMap } from '../src/world/SurfaceMap'
import { minimapPixels } from '../src/ui/minimapRaster'
import { Minimap } from '../src/ui/Minimap'

const fixture = vi.hoisted(() => ({ game: {} as Record<string, unknown>, telemetry: {} as Record<string, unknown>, image: '' }))
vi.mock('../src/ui/hooks', () => ({
  useGame: (select: (state: unknown) => unknown) => select(fixture.game),
  useTelemetry: (select: (state: unknown) => unknown) => select(fixture.telemetry),
}))
vi.mock('../src/ui/minimapRaster', async importOriginal => {
  const original = await importOriginal<typeof import('../src/ui/minimapRaster')>()
  return { ...original, minimapRasterUrl: () => fixture.image }
})

it('renders real side-road coverage with a clipped heading-up route and independent clip IDs', async () => {
  const base = 'public/models/tracks/u2city/'
  const track = JSON.parse(readFileSync(base + 'track.json', 'utf8'))
  const overview = new SurfaceMap(track.surface, decodeSurfaceRle(readFileSync(base + track.surface.url), track.surface.width * track.surface.height)).overview()
  const pixels = minimapPixels(overview)
  const png = await sharp(Buffer.from(pixels), { raw: { width: overview.width, height: overview.height, channels: 4 } }).png().toBuffer()
  fixture.image = 'data:image/png;base64,' + png.toString('base64')
  const points = track.line.map((point: number[]) => [point[0], point[2]])
  const index = Math.floor(points.length * .2)
  const [x, z] = points[index], [nx, nz] = points[(index + 1) % points.length]
  fixture.game = { settings: { mode: 'race' }, minimap: { points, gates: [], overview } }
  fixture.telemetry = { opponents: [], driftGate: -1, carX: x, carZ: z, heading: Math.atan2(nx - x, nz - z), trackIndex: index, distanceLeft: 1840 }
  const markup = renderToStaticMarkup(<><Minimap /><Minimap /></>)
  const clipIds = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map(match => match[1])
  expect(new Set(clipIds).size).toBe(2)
  expect(markup).toContain(fixture.image)
  expect(markup).toContain('minimap__route')
  if (process.env.CAPTURE_MINIMAP) {
    const sourceCss = readFileSync('src/index.css', 'utf8')
    const css = sourceCss.slice(sourceCss.indexOf('.minimap {'), sourceCss.indexOf('/* ── Wrong way'))
    const svg = markup.match(/<svg[\s\S]*?<\/svg>/)![0].replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" ')
      .replace('>', `><style>${css}</style>`)
    writeFileSync('/tmp/racing-minimap-preview.svg', svg)
    await sharp(Buffer.from(svg)).png().toFile('/tmp/racing-minimap-preview.png')
  }
})
