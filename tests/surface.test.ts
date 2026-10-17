import { describe, expect, it } from 'vitest'
import { Surface } from '../src/vehicles/Surface'
import { decodeSurfaceRle, measureRoadEdges, SurfaceMap } from '../src/world/SurfaceMap'

/** Mirror of the encoder in scripts/track/derive-from-chunks.mjs. */
function encode(cells: number[]): Uint8Array {
  const out: number[] = []
  for (let i = 0; i < cells.length; ) {
    let j = i
    while (j < cells.length && cells[j] === cells[i]) j++
    out.push(cells[i])
    for (let run = j - i; ; ) {
      const b = run & 0x7f
      run >>>= 7
      if (run) out.push(b | 0x80)
      else {
        out.push(b)
        break
      }
    }
    i = j
  }
  return Uint8Array.from(out)
}

describe('decodeSurfaceRle', () => {
  it('round-trips short and long (multi-byte varint) runs', () => {
    const cells = [...Array(3).fill(1), ...Array(300).fill(4), 2, ...Array(20000).fill(0), 3]
    expect(Array.from(decodeSurfaceRle(encode(cells), cells.length))).toEqual(cells)
  })
})

describe('SurfaceMap', () => {
  const map = new SurfaceMap({ url: '', x0: -2, z0: -1, res: 1, width: 4, height: 2 }, Uint8Array.from([1, 1, 2, 4, 3, 3, 5, 5]))

  it('looks up cells by world XZ', () => {
    expect(map.at(-1.5, -0.5)).toBe(Surface.Asphalt)
    expect(map.at(1.2, -0.1)).toBe(Surface.Sand)
    expect(map.at(0.5, 0.5)).toBe(Surface.Gravel)
  })

  it('is open terrain off the grid', () => {
    expect(map.at(-50, 0)).toBe(Surface.None)
    expect(map.at(0, 9)).toBe(Surface.None)
  })

  it('builds a ribbon road: asphalt, then kerb, then grass', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: 0, z: i * 4 - 100 }))
    line.push(...Array.from({ length: 50 }, (_, i) => ({ x: 400, z: 100 - i * 4 })))
    const ribbon = SurfaceMap.fromRibbon(line, 6, 1.2)
    expect(ribbon.at(0.5, 0)).toBe(Surface.Asphalt)
    expect(ribbon.at(6.6, 0)).toBe(Surface.Kerb)
    expect(ribbon.at(12, 0)).toBe(Surface.Grass)
  })
})

describe('measureRoadEdges', () => {
  it('finds the paved edge either side of the centreline', () => {
    // Straight road along +Z, paved from x = -3 (right of travel) to x = +7 (left).
    const line = Array.from({ length: 20 }, (_, i) => ({ x: 0, z: i * 4 }))
    const at = (x: number) => (x > -3 && x < 7 ? Surface.Asphalt : Surface.Grass)
    const { left, right } = measureRoadEdges(line, at)
    // 0.5 m march resolution.
    expect(Math.abs(left[10] - 7)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(right[10] - 3)).toBeLessThanOrEqual(0.5)
  })
})
