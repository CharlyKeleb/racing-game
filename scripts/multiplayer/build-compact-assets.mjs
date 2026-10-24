import { readFile, writeFile } from 'node:fs/promises'
import { encodeSimulationBundle } from './compact-assets.ts'

const source = new URL('../../.cache/multiplayer/simulation-assets.json', import.meta.url)
const output = new URL('../../.cache/multiplayer/simulation-assets.bin', import.meta.url)
const json = await readFile(source, 'utf8'), bundle = JSON.parse(json)
const compact = encodeSimulationBundle(bundle)
await writeFile(output, compact)
console.info(JSON.stringify({ format: 'RGAS/1', fingerprint: bundle.fingerprint, jsonBytes: Buffer.byteLength(json), compactBytes: compact.byteLength }))
