// node --experimental-strip-types scripts/audio/preview-impacts.mjs /absolute/output.wav
import { writeFileSync } from 'node:fs'
import { makeImpactPCM } from '../../src/audio/ImpactPCM.ts'
const path = process.argv[2]
if (!path) throw new Error('Pass the output WAV path')
const rate = 48000
const examples = [['wall', .25], ['wall', .6], ['wall', 1], ['car', .8], ['ground', .7], ['curb', .6]]
const samples = new Float32Array(rate * (examples.length + .3))
for (let j = 0; j < examples.length; j++) {
  const [kind, strength] = examples[j]
  const pcm = makeImpactPCM(kind, strength, 731 + j * 271, rate)
  const gain = .9 * 1.25 * (.05 + .95 * strength ** .85)
  for (let i = 0; i < pcm.length; i++) samples[Math.floor(rate * (.15 + j)) + i] = pcm[i] * gain
}
const wav = Buffer.alloc(44 + samples.length * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40)
for (let i = 0; i < samples.length; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
writeFileSync(path, wav)
console.log(`Wrote ${path}: light/medium/heavy wall, car, landing, kerb`)
