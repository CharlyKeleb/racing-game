// Meshopt-compresses an already-prepared car GLB in place (quantised, filtered
// vertex/index streams; decoded by AssetManager's MeshoptDecoder). Node names,
// materials and wheel origins are kept. Quantisation is per mesh, so each wheel
// mesh stays centred on its axle (CarModel zeroes the wheel node's position).
//
// usage: node scripts/cars/compress-car.mjs <in.glb> [out.glb]
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { meshopt, prune } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer'
import { statSync } from 'node:fs'

const [input, output = input] = process.argv.slice(2)
await MeshoptEncoder.ready
await MeshoptDecoder.ready
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder })
const before = statSync(input).size
const doc = await io.read(input)
await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium', quantizationVolume: 'mesh' }))
await io.write(output, doc)
console.log(`${input}: ${(before / 1e6).toFixed(2)} MB → ${(statSync(output).size / 1e6).toFixed(2)} MB`)
