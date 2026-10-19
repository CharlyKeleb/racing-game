import { minimapRoadLines, minimapRoadPath } from '../src/world/MinimapRoads'
import { describe, expect, it } from 'vitest'
import { buildMinimapRaster } from '../src/world/MinimapData'
import { Surface } from '../src/vehicles/Surface'
import { MINIMAP_PALETTE, minimapPixels } from '../src/ui/minimapRaster'
import { SurfaceMap } from '../src/world/SurfaceMap'

const info = { x0: -20, z0: 40, res: 2, width: 6, height: 6, url: '' }

describe('full minimap surface coverage', () => {
  it('preserves a narrow side road when downsampling surrounding grass', () => {
    const cells = new Uint8Array(36).fill(Surface.Grass)
    for (let z = 0; z < 6; z++) cells[z * 6 + 4] = Surface.Asphalt
    const overview = buildMinimapRaster(info, cells, 3)
    expect(overview.width).toBe(3)
    expect(overview.cellSize).toBe(4)
    expect(overview.x).toBe(-20)
    expect(overview.z).toBe(40)
    for (let z = 0; z < 3; z++) {
      expect(overview.cells[z * 3 + 2]).toBe(Surface.Asphalt)
      expect(overview.cells[z * 3]).toBe(Surface.Grass)
    }
  })
  it('shows disconnected paved areas independently of any race route', () => {
    const cells = new Uint8Array(36)
    cells[0] = Surface.Asphalt; cells[35] = Surface.Asphalt
    const overview = buildMinimapRaster(info, cells)
    expect(Array.from(overview.cells).filter(value => value === Surface.Asphalt)).toHaveLength(2)
    expect(overview.cells[18]).toBe(Surface.None)
  })
  it('caches the overview and keeps road contrast above dimmed scenery', () => {
    const map = new SurfaceMap(info, new Uint8Array(36).fill(Surface.Asphalt))
    expect(map.overview()).toBe(map.overview())
    const pixels = minimapPixels(map.overview())
    expect(Array.from(pixels.slice(0, 4))).toEqual(MINIMAP_PALETTE[Surface.Asphalt])
    const brightness = (code: number) => MINIMAP_PALETTE[code].slice(0, 3).reduce((sum, value) => sum + value, 0)
    expect(brightness(Surface.Asphalt)).toBeGreaterThan(brightness(Surface.Grass) * 2)
    expect(MINIMAP_PALETTE[Surface.None][3]).toBe(0)
  })
})


it('thins a broad junction while keeping all four road branches connected', () => {
  const width = 21, cells = new Uint8Array(width * width)
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) if (Math.abs(x - 10) <= 2 || Math.abs(y - 10) <= 2) cells[y * width + x] = Surface.Asphalt
  const data = { x: 0, z: 0, cellSize: 1, width, height: width, cells }
  const lines = minimapRoadLines(data)
  expect(lines[10 * width + 10]).toBe(1)
  for (const i of [3 * width + 10, 17 * width + 10, 10 * width + 3, 10 * width + 17]) expect(lines[i]).toBe(1)
  expect(lines.reduce((sum, value) => sum + value, 0)).toBeLessThan(70)
  const path = minimapRoadPath(data)
  expect(path).toContain('M')
  expect(path).not.toMatch(/NaN|Infinity/)
  expect(minimapRoadPath(data)).toBe(path)
})
