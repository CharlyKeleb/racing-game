// Builds public/audio/backfire/backfire-bank.wav + .json from CC0 Freesound recordings.
//   node scripts/audio/build-backfire-bank.mjs <download dir> [out dir]
// Needs ffmpeg on PATH. Credits: public/audio/backfire/CREDITS.md.
//
// Two kinds of exhaust pop: `crackle` (the short, sharp pops of overrun /
// anti-lag, fired in quick bursts) and `bang` (the big "POOO" of a supercar
// upshift or a burnout backfire). Each cut starts on its pop's transient
// (searched near the listed time), fades out and is loudness-matched per kind.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RATE = 44100
/** Body loudness (RMS over the first 60 ms after the onset) per kind, dBFS. */
const KIND_RMS = { crackle: -16, bang: -12 }

/** Freesound preview id → what it is. All CC0 1.0. */
const SOURCES = {
  antilag: { id: '797835_15956618', page: 'https://freesound.org/people/modusmogulus/sounds/797835/', title: 'Car Antilag (No cleanup, 32float)', author: 'modusmogulus' },
  supercar: { id: '478756_1481531', page: 'https://freesound.org/people/richwise/sounds/478756/', title: 'Supercar rev', author: 'richwise' },
  engine: { id: '385935_7097737', page: 'https://freesound.org/people/P%C3%B3l/sounds/385935/', title: 'S012_Engine_Backfire_Mono.wav', author: 'Pól' },
  vintage: { id: '675723_2524442', page: 'https://freesound.org/people/craigsmith/sounds/675723/', title: 'S41-25 Car backfires; reverberant.wav', author: 'craigsmith' },
  deep: { id: '105351_1553758', page: 'https://freesound.org/people/CeebFrack/sounds/105351/', title: 'BACKFIRE.ogg', author: 'CeebFrack' },
}

/** kind → variants: [source, pop near this time (s), max length (s)]. */
const BANK = {
  crackle: [['antilag', 1.57, 0.22], ['antilag', 2.175, 0.22], ['antilag', 1.77, 0.22], ['supercar', 6.53, 0.25], ['supercar', 7.18, 0.25]],
  bang: [['engine', 0.21, 0.5], ['vintage', 5.035, 0.6], ['vintage', 1.82, 0.6], ['deep', 0.21, 0.55]],
}

const [srcDir, outDir = 'public/audio/backfire'] = process.argv.slice(2)
if (!srcDir) throw new Error('Pass the download directory')
mkdirSync(srcDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

async function decode(name) {
  const { id } = SOURCES[name]
  const file = join(srcDir, `${id}.mp3`)
  if (!existsSync(file)) {
    const res = await fetch(`https://cdn.freesound.org/previews/${Math.floor(Number(id.split('_')[0]) / 1000)}/${id}-hq.mp3`)
    if (!res.ok) throw new Error(`Download failed: ${name} ${res.status}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'], { maxBuffer: 1 << 28 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

/** Cut the pop near `at`: from its transient, `maxSec` long, faded, loudness-matched. */
function cut(x, at, maxSec, kind) {
  // The loudest 2 ms within ±40 ms of the listed time is the pop; start just before its rise.
  const from = Math.max(0, Math.round((at - 0.04) * RATE)), to = Math.min(x.length, Math.round((at + 0.04) * RATE))
  let peakAt = from, peak = 0
  for (let i = from; i < to; i++) if (Math.abs(x[i]) > peak) { peak = Math.abs(x[i]); peakAt = i }
  let onset = peakAt
  while (onset > from && Math.abs(x[onset]) > peak * 0.08) onset--
  onset = Math.max(0, onset - Math.round(RATE * 0.002))
  const length = Math.min(x.length - onset, Math.round(maxSec * RATE))
  const out = x.slice(onset, onset + length)
  const fadeIn = Math.round(RATE * 0.001), fadeOut = Math.round(length * 0.5)
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn
  for (let i = 0; i < fadeOut; i++) out[length - 1 - i] *= (i / fadeOut) ** 1.5
  let sum = 0
  const body = Math.min(length, Math.round(RATE * 0.06))
  for (let i = 0; i < body; i++) sum += out[i] * out[i]
  const gain = 10 ** (KIND_RMS[kind] / 20) / (Math.sqrt(sum / body) || 1)
  let outPeak = 0
  for (let i = 0; i < length; i++) outPeak = Math.max(outPeak, Math.abs((out[i] *= gain)))
  if (outPeak > 0.97) for (let i = 0; i < length; i++) out[i] *= 0.97 / outPeak
  return out
}

const decoded = {}
for (const variants of Object.values(BANK)) for (const [name] of variants) decoded[name] ??= await decode(name)
const pieces = []
const index = { rate: RATE, kinds: {} }
let cursor = 0
const gap = Math.round(RATE * 0.02)
for (const [kind, variants] of Object.entries(BANK)) {
  index.kinds[kind] = variants.map(([name, at, maxSec]) => {
    const pcm = cut(decoded[name], at, maxSec, kind)
    const start = cursor
    pieces.push(pcm, new Float32Array(gap))
    cursor += pcm.length + gap
    return { source: name, start, length: pcm.length }
  })
}

const total = pieces.reduce((n, p) => n + p.length, 0)
const wav = Buffer.alloc(44 + total * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(total * 2, 40)
let o = 44
for (const p of pieces) for (const v of p) { wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), o); o += 2 }
writeFileSync(join(outDir, 'backfire-bank.wav'), wav)
writeFileSync(join(outDir, 'backfire-bank.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`Wrote ${outDir}/backfire-bank.wav (${(total / RATE).toFixed(2)} s, ${(wav.length / 1024).toFixed(0)} KB) + backfire-bank.json`)
