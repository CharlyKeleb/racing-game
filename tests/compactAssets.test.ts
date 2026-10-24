import { createHash } from 'node:crypto'
import { beforeAll, expect, it } from 'vitest'
import { encodeSimulationBundle, decodeSimulationBundle } from '../scripts/multiplayer/compact-assets'
import type { SimulationBundle } from '../scripts/multiplayer/race-factory'
import { HeadlessSimulation } from '../src/simulation/HeadlessSimulation'
import { DEFAULT_VEHICLE_CONFIG as config } from '../src/vehicles/VehicleConfig'
// @ts-expect-error Trusted Node build exporter has no declarations.
import { buildSimulationAssets } from '../scripts/multiplayer/build-simulation-assets.mjs'

const fixture: SimulationBundle = { format: 1, fingerprint: 'a'.repeat(64), cars: { porsche911: config }, track: {
  id: 'nurburgring', spawn: { position: { x: 0, y: .3, z: 0 }, heading: 0 }, line: [], checkpoints: [],
  meshes: [{ vertices: [-1000,0,-1000,-1000,0,1000,1000,0,1000,1000,0,-1000], indices: [0,1,2,0,2,3], barrier: false }],
  surface: { info: { url: 'surface.rle', x0: -1000, z0: -1000, res: 1000, width: 2, height: 2 }, cells: [0,1,2,5] },
} }
let actual: SimulationBundle
beforeAll(async () => { actual = await buildSimulationAssets() })
function sameBytes(actual: Float32Array | Uint32Array | Uint8Array, expected: Float32Array | Uint32Array | Uint8Array) {
  expect(actual.constructor).toBe(expected.constructor)
  expect(Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength)
    .equals(Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength))).toBe(true)
}
function rehash(bytes: Buffer) { createHash('sha256').update(bytes.subarray(48)).digest().copy(bytes, 16); return bytes }
function changeMetadata(edit: (metadata: Record<string, unknown>) => void): Buffer {
  const bytes = encodeSimulationBundle(fixture), length = bytes.readUInt32LE(8), offset = 48 + Math.ceil(length / 4) * 4
  const metadata = JSON.parse(bytes.toString('utf8', 48, 48 + length)); edit(metadata)
  const json = Buffer.from(JSON.stringify(metadata)), nextOffset = 48 + Math.ceil(json.length / 4) * 4
  const result = Buffer.alloc(nextOffset + bytes.length - offset)
  bytes.copy(result, 0, 0, 48); result.writeUInt32LE(json.length, 8); json.copy(result, 48); bytes.copy(result, nextOffset, offset)
  return rehash(result)
}
it('preserves every exported real-track float32 vertex, index, surface cell and compatibility field', () => {
  const encoded = encodeSimulationBundle(actual), decoded = decodeSimulationBundle(encoded)
  expect(decoded.format).toBe(actual.format); expect(decoded.fingerprint).toBe(actual.fingerprint)
  expect(decoded.cars).toEqual(actual.cars)
  expect(decoded.track.line).toEqual(actual.track.line); expect(decoded.track.spawn).toEqual(actual.track.spawn)
  expect(decoded.track.checkpoints).toEqual(actual.track.checkpoints)
  expect(decoded.track.meshes).toHaveLength(actual.track.meshes.length)
  for (let i = 0; i < actual.track.meshes.length; i++) {
    const input = actual.track.meshes[i], output = decoded.track.meshes[i]
    expect(output.barrier).toBe(input.barrier)
    expect(output.vertices).toBeInstanceOf(Float32Array); expect(output.indices).toBeInstanceOf(Uint32Array)
    sameBytes(output.vertices as Float32Array, Float32Array.from(input.vertices))
    sameBytes(output.indices as Uint32Array, Uint32Array.from(input.indices))
  }
  expect(decoded.track.surface?.info).toEqual(actual.track.surface?.info)
  sameBytes(decoded.track.surface!.cells as Uint8Array, Uint8Array.from(actual.track.surface!.cells))
  expect(encoded.length).toBeLessThan(Buffer.byteLength(JSON.stringify(actual)) * .5)
})
it('supports unaligned input safely and retains aligned typed views without geometry copies', () => {
  const encoded = encodeSimulationBundle(fixture), aligned = decodeSimulationBundle(encoded)
  expect((aligned.track.meshes[0].vertices as Float32Array).buffer).toBe(encoded.buffer)
  const unaligned = Buffer.alloc(encoded.length + 1); encoded.copy(unaligned, 1)
  const decoded = decodeSimulationBundle(unaligned.subarray(1))
  expect(decoded.track.meshes).toEqual(aligned.track.meshes)
  expect((decoded.track.meshes[0].vertices as Float32Array).buffer).not.toBe(unaligned.buffer)
  const noSurface = structuredClone(fixture); noSurface.track.surface = null
  expect(decodeSimulationBundle(encodeSimulationBundle(noSurface)).track.surface).toBeNull()
})
it('rejects corrupt headers, checksums, truncation, tails, oversized counts and invalid geometry/surface bytes', () => {
  const encoded = encodeSimulationBundle(fixture)
  for (const length of [0, 47, 48, encoded.length - 1]) expect(() => decodeSimulationBundle(encoded.subarray(0, length))).toThrow()
  expect(() => decodeSimulationBundle(Buffer.concat([encoded, Buffer.from([0])]))).toThrow()
  for (const byte of [0,4,8,12,16,encoded.length - 1]) {
    const damaged = Buffer.from(encoded); damaged[byte] ^= 255
    expect(() => decodeSimulationBundle(damaged)).toThrow()
  }
  for (const edit of [ (m: Record<string, unknown>) => { m.format = 2 }, (m: Record<string, unknown>) => { m.fingerprint = 'bad' },
    (m: Record<string, unknown>) => { (m.track as typeof fixture.track).meshes = [] },
    (m: Record<string, unknown>) => { ((m.track as { meshes: { vertices: number }[] }).meshes[0]).vertices = 2 ** 32 },
    (m: Record<string, unknown>) => { ((m.track as { meshes: { indices: number }[] }).meshes[0]).indices = 5 },
    (m: Record<string, unknown>) => { ((m.track as { surface: { cells: number } }).surface).cells = 1 } ]) {
    expect(() => decodeSimulationBundle(changeMetadata(edit))).toThrow()
  }
  const start = 48 + Math.ceil(encoded.readUInt32LE(8) / 4) * 4
  const nonfinite = Buffer.from(encoded); nonfinite.writeFloatLE(NaN, start)
  expect(() => decodeSimulationBundle(rehash(nonfinite))).toThrow()
  const badIndex = Buffer.from(encoded); badIndex.writeUInt32LE(99999, start + fixture.track.meshes[0].vertices.length * 4)
  expect(() => decodeSimulationBundle(rehash(badIndex))).toThrow()
  const badSurface = Buffer.from(encoded); badSurface[badSurface.length - 1] = 255
  expect(() => decodeSimulationBundle(rehash(badSurface))).toThrow()
  for (const edit of [ (b: SimulationBundle) => { b.track.meshes[0].vertices[0] = Infinity },
    (b: SimulationBundle) => { b.track.meshes[0].indices[0] = -1 }, (b: SimulationBundle) => { b.track.surface!.cells[0] = 6 },
    (b: SimulationBundle) => { b.track.surface!.info.width = .5 } ]) {
    const bad = structuredClone(fixture); edit(bad); expect(() => encodeSimulationBundle(bad)).toThrow()
  }
})
it('runs identical ghost-car physics from JSON arrays and compact typed arrays in one runtime', async () => {
  const decoded = decodeSimulationBundle(encodeSimulationBundle(fixture))
  const a = await HeadlessSimulation.create(fixture.track), b = await HeadlessSimulation.create(decoded.track)
  try {
    for (const world of [a, b]) for (const id of ['one', 'two']) world.addRacer(id, config,
      { position: { x: id === 'one' ? 0 : 6, y: .3, z: 0 }, heading: 0 })
    for (let tick = 0; tick < 240; tick++) for (const world of [a, b]) {
      for (const id of ['one', 'two']) world.setInput(id, { throttle: tick < 180 ? 1 : .2, brake: tick > 200 ? .6 : 0,
        steer: tick > 120 ? .2 : 0, handbrake: false, nitro: tick > 80 && tick < 110 })
      world.step()
    }
    for (const id of ['one', 'two']) {
      expect(a.vehicles.get(id)!.body.translation()).toEqual(b.vehicles.get(id)!.body.translation())
      expect(a.vehicles.get(id)!.body.rotation()).toEqual(b.vehicles.get(id)!.body.rotation())
      expect(a.vehicles.get(id)!.controller.captureState()).toEqual(b.vehicles.get(id)!.controller.captureState())
    }
  } finally { a.dispose(); b.dispose() }
})
