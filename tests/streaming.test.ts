import { describe, expect, it } from 'vitest'
import { distanceToChunk, NOT_LOADED, planLods, type ChunkInfo, type StreamRadii } from '../src/world/streaming/ChunkPlanner'

// A row of 200 m chunks along +X: [0,200], [200,400], ... [1800,2000]
const chunks: ChunkInfo[] = Array.from({ length: 10 }, (_, i) => ({ minX: i * 200, maxX: i * 200 + 200, minZ: 0, maxZ: 200, lodCount: 2 }))
const radii: StreamRadii = { lod0: 150, lod1: 500, hysteresis: 50 }

function plan(x: number, current = new Int8Array(chunks.length).fill(NOT_LOADED), aheadX = x) {
  const out = new Int8Array(chunks.length)
  const dist = new Float32Array(chunks.length)
  planLods(chunks, [x, 100], [aheadX, 100], radii, current, out, dist)
  return { out: Array.from(out), dist }
}

describe('distanceToChunk', () => {
  it('is zero inside and euclidean outside', () => {
    expect(distanceToChunk(chunks[0], 50, 50)).toBe(0)
    expect(distanceToChunk(chunks[0], 230, 50)).toBe(30)
    expect(distanceToChunk(chunks[0], 230, 240)).toBe(50)
  })
})

describe('planLods', () => {
  it('rings full detail, reduced detail, then nothing', () => {
    // Car in chunk 0 at x=100: chunk1 is 100 m away, chunk2 300 m, chunk3 500 m.
    expect(plan(100).out).toEqual([0, 0, 1, NOT_LOADED, NOT_LOADED, NOT_LOADED, NOT_LOADED, NOT_LOADED, NOT_LOADED, NOT_LOADED])
  })

  it('prefetches toward the look-ahead point', () => {
    // Driving +X fast: ahead point 600 m further pulls in chunks near x=700.
    const { out } = plan(100, undefined, 700)
    expect(out[3]).toBe(0)
    expect(out[5]).toBe(1)
  })

  it('applies hysteresis instead of flickering on a boundary', () => {
    const current = new Int8Array(chunks.length).fill(NOT_LOADED)
    current[2] = 0 // chunk 2 currently LOD0, now 160 m away (just past lod0)
    expect(plan(240, current).out[2]).toBe(0)
    current[4] = 1 // chunk 4 currently LOD1, 520 m away (just past lod1)
    expect(plan(280, current).out[4]).toBe(1)
    // Well past the hysteresis band it drops.
    expect(plan(0, current).out[4]).toBe(NOT_LOADED)
  })

  it('falls back to the best available LOD', () => {
    const single: ChunkInfo[] = [{ minX: 0, maxX: 200, minZ: 0, maxZ: 200, lodCount: 1 }]
    const out = new Int8Array(1)
    planLods(single, [500, 100], [500, 100], radii, new Int8Array([NOT_LOADED]), out, new Float32Array(1))
    expect(out[0]).toBe(0) // wants LOD1 but only LOD0 exists
  })

  it('reports distances for load priority', () => {
    const { dist } = plan(100)
    expect(dist[0]).toBe(0)
    expect(dist[2]).toBe(300)
  })
})
