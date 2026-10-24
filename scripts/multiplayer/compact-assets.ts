import { createHash, timingSafeEqual } from 'node:crypto'
import { endianness } from 'node:os'
import type { SimulationBundle } from './race-factory'

const HEADER = 48, MAX_FILE = 64 * 1024 * 1024, MAX_METADATA = 1024 * 1024, MAX_MESHES = 4096
const padded = (length: number) => Math.ceil(length / 4) * 4
type MeshDescription = { vertices: number; indices: number; barrier: boolean }
type Metadata = Omit<SimulationBundle, 'track'> & { track: Omit<SimulationBundle['track'], 'meshes' | 'surface'> & {
  meshes: MeshDescription[]; surface: { info: NonNullable<SimulationBundle['track']['surface']>['info']; cells: number } | null
} }
function invalid(): never { throw new Error('Invalid compact simulation asset file') }
function count(value: number): boolean { return Number.isSafeInteger(value) && value > 0 && value <= MAX_FILE / 4 }
function checkPlatform() { if (endianness() !== 'LE') throw new Error('Compact simulation assets require a little-endian runtime') }

/** Trusted build input only. Geometry is the same float32/uint32 representation Rapier consumes. */
export function encodeSimulationBundle(bundle: SimulationBundle): Buffer {
  checkPlatform()
  if (bundle.format !== 1 || !/^[a-f0-9]{64}$/.test(bundle.fingerprint) || !bundle.track.meshes.length || bundle.track.meshes.length > MAX_MESHES) return invalid()
  let payloadLength = 0
  const meshes = bundle.track.meshes.map(mesh => {
    if (!count(mesh.vertices.length) || mesh.vertices.length % 3 || !count(mesh.indices.length) || mesh.indices.length % 3 || typeof mesh.barrier !== 'boolean') return invalid()
    for (const vertex of mesh.vertices) if (!Number.isFinite(vertex) || !Number.isFinite(Math.fround(vertex))) return invalid()
    for (const index of mesh.indices) if (!Number.isSafeInteger(index) || index < 0 || index >= mesh.vertices.length / 3) return invalid()
    payloadLength += (mesh.vertices.length + mesh.indices.length) * 4
    if (payloadLength > MAX_FILE) return invalid()
    return { vertices: mesh.vertices.length, indices: mesh.indices.length, barrier: mesh.barrier }
  })
  const surface = bundle.track.surface
  if (surface) {
    if (!count(surface.cells.length) || !Number.isSafeInteger(surface.info.width) || surface.info.width <= 0
      || !Number.isSafeInteger(surface.info.height) || surface.info.height <= 0 || surface.cells.length !== surface.info.width * surface.info.height) return invalid()
    for (const cell of surface.cells) if (!Number.isInteger(cell) || cell < 0 || cell > 5) return invalid()
    payloadLength += surface.cells.length
  }
  const metadata: Metadata = { ...bundle, track: { ...bundle.track, meshes, surface: surface ? { info: surface.info, cells: surface.cells.length } : null } }
  const json = Buffer.from(JSON.stringify(metadata), 'utf8')
  const offset = HEADER + padded(json.length)
  if (json.length > MAX_METADATA || offset + payloadLength > MAX_FILE) return invalid()
  const output = Buffer.alloc(offset + payloadLength)
  output.write('RGAS', 0, 'ascii'); output.writeUInt32LE(1, 4)
  output.writeUInt32LE(json.length, 8); output.writeUInt32LE(payloadLength, 12); json.copy(output, HEADER)
  let cursor = offset
  for (const mesh of bundle.track.meshes) {
    const vertices = new Float32Array(output.buffer, output.byteOffset + cursor, mesh.vertices.length)
    vertices.set(mesh.vertices); cursor += vertices.byteLength
    const indices = new Uint32Array(output.buffer, output.byteOffset + cursor, mesh.indices.length)
    indices.set(mesh.indices); cursor += indices.byteLength
  }
  if (surface) output.set(surface.cells, cursor)
  createHash('sha256').update(output.subarray(HEADER)).digest().copy(output, 16)
  return output
}

/** Bounded/checksummed local file, never a client upload. Returned typed views retain the file buffer. */
export function decodeSimulationBundle(input: Uint8Array): SimulationBundle {
  checkPlatform()
  if (input.byteLength < HEADER || input.byteLength > MAX_FILE) return invalid()
  // readFile normally returns aligned storage; a caller may supply an unaligned slice.
  const aligned = input.byteOffset % 4 ? Uint8Array.from(input) : input
  const bytes = Buffer.from(aligned.buffer, aligned.byteOffset, aligned.byteLength)
  if (bytes.toString('ascii', 0, 4) !== 'RGAS' || bytes.readUInt32LE(4) !== 1) return invalid()
  const jsonLength = bytes.readUInt32LE(8), payloadLength = bytes.readUInt32LE(12), offset = HEADER + padded(jsonLength)
  if (!jsonLength || jsonLength > MAX_METADATA || offset + payloadLength !== bytes.length
    || !timingSafeEqual(bytes.subarray(16, 48), createHash('sha256').update(bytes.subarray(HEADER)).digest())) return invalid()
  let metadata: Metadata
  try { metadata = JSON.parse(bytes.toString('utf8', HEADER, HEADER + jsonLength)) as Metadata } catch { return invalid() }
  if (!metadata || metadata.format !== 1 || typeof metadata.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(metadata.fingerprint)
    || !metadata.track || !Array.isArray(metadata.track.meshes) || !metadata.track.meshes.length || metadata.track.meshes.length > MAX_MESHES) return invalid()
  let expectedLength = 0
  for (const mesh of metadata.track.meshes) {
    if (!mesh || !count(mesh.vertices) || mesh.vertices % 3 || !count(mesh.indices) || mesh.indices % 3 || typeof mesh.barrier !== 'boolean') return invalid()
    expectedLength += (mesh.vertices + mesh.indices) * 4
  }
  const surface = metadata.track.surface
  if (surface !== null) {
    if (!surface || !count(surface.cells) || !surface.info || !Number.isSafeInteger(surface.info.width) || surface.info.width <= 0
      || !Number.isSafeInteger(surface.info.height) || surface.info.height <= 0 || surface.cells !== surface.info.width * surface.info.height) return invalid()
    expectedLength += surface.cells
  }
  if (expectedLength !== payloadLength) return invalid()
  let cursor = offset
  const meshes = metadata.track.meshes.map(mesh => {
    const vertices = new Float32Array(bytes.buffer, bytes.byteOffset + cursor, mesh.vertices)
    cursor += vertices.byteLength
    const indices = new Uint32Array(bytes.buffer, bytes.byteOffset + cursor, mesh.indices)
    cursor += indices.byteLength
    for (const vertex of vertices) if (!Number.isFinite(vertex)) return invalid()
    for (const index of indices) if (index >= vertices.length / 3) return invalid()
    return { vertices, indices, barrier: mesh.barrier }
  })
  const cells = surface ? new Uint8Array(bytes.buffer, bytes.byteOffset + cursor, surface.cells) : null
  if (cells) for (const cell of cells) if (cell > 5) return invalid()
  return { ...metadata, track: { ...metadata.track, meshes, surface: surface && cells ? { info: surface.info, cells } : null } }
}
