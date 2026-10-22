// Builds public/audio/impacts/impact-bank.wav + .json from CC0 Freesound recordings.
//   node scripts/audio/build-impact-bank.mjs <download dir> [out dir]
// Needs ffmpeg on PATH. Credits: public/audio/impacts/CREDITS.md.
//
// Each source is decoded to mono, cut from its first transient (so a hit sounds
// the instant it happens), faded out, and loudness-matched per tier, so variants
// in one tier swap without a jump in level. The game picks a tier by hit strength
// and scales within it (ImpactSound.hit).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RATE = 44100
/** Body loudness (RMS over the first 150 ms after the onset) per tier, dBFS. */
const TIER_RMS = [-22, -17, -13]

/** Freesound preview id → what it is. All CC0 1.0. */
const SOURCES = {
  fastCollision: { id: '332056_71257', page: 'https://freesound.org/people/qubodup/sounds/332056/', title: 'Fast Collision', author: 'qubodup' },
  metalHit: { id: '321482_5485024', page: 'https://freesound.org/people/dslrguide/sounds/321482/', title: 'Metal Hit 2', author: 'dslrguide' },
  collision: { id: '332058_71257', page: 'https://freesound.org/people/qubodup/sounds/332058/', title: 'Collision', author: 'qubodup' },
  clank: { id: '151624_71257', page: 'https://freesound.org/people/qubodup/sounds/151624/', title: 'Clank Car Crash Collision', author: 'qubodup' },
  crashLong: { id: '807437_3797507', page: 'https://freesound.org/people/Logicogonist/sounds/807437/', title: 'car crash long 1', author: 'Logicogonist' },
  crashGlass: { id: '592388_11537497', page: 'https://freesound.org/people/magnuswaker/sounds/592388/', title: 'Car Crash (with Glass)', author: 'magnuswaker' },
  doorHit: { id: '340539_4959511', page: 'https://freesound.org/people/mickyman5000/sounds/340539/', title: 'Car_Door_Hit.wav', author: 'mickyman5000' },
  hood: { id: '329516_424694', page: 'https://freesound.org/people/LPA134/sounds/329516/', title: 'Hood Impact', author: 'LPA134' },
}

/** kind → tiers (light, medium, heavy) → variants: [source, max seconds]. */
const BANK = {
  wall: [
    [['fastCollision', 0.25], ['metalHit', 0.5]],
    [['collision', 0.8], ['clank', 0.55]],
    [['crashLong', 1], ['crashGlass', 1.6]],
  ],
  car: [
    [['doorHit', 0.22], ['fastCollision', 0.25]],
    [['hood', 0.9], ['clank', 0.55]],
    [['crashLong', 1], ['collision', 0.8]],
  ],
}

const [srcDir, outDir = 'public/audio/impacts'] = process.argv.slice(2)
if (!srcDir) throw new Error('Pass the download directory')
mkdirSync(srcDir, { recursive: true })
mkdirSync(outDir, { recursive: true })

async function source(name) {
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

const rms = (x, from, n) => {
  let s = 0
  const end = Math.min(x.length, from + n)
  for (let i = from; i < end; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, end - from))
}

/** Cut from the first transient, fade the tail, match the tier's body loudness. */
function cut(x, maxSec, tier) {
  let peak = 0
  for (const v of x) peak = Math.max(peak, Math.abs(v))
  let onset = x.findIndex((v) => Math.abs(v) > peak * 0.1)
  onset = Math.max(0, onset - Math.round(RATE * 0.002))
  const length = Math.min(x.length - onset, Math.round(maxSec * RATE))
  const out = x.slice(onset, onset + length)
  const fadeIn = Math.round(RATE * 0.001), fadeOut = Math.round(length * 0.35)
  for (let i = 0; i < fadeIn; i++) out[i] *= i / fadeIn
  for (let i = 0; i < fadeOut; i++) out[length - 1 - i] *= (i / fadeOut) ** 1.5
  const gain = 10 ** (TIER_RMS[tier] / 20) / (rms(out, 0, Math.round(RATE * 0.15)) || 1)
  let outPeak = 0
  for (let i = 0; i < length; i++) outPeak = Math.max(outPeak, Math.abs((out[i] *= gain)))
  // Never clip: a very peaky source gets turned down instead.
  if (outPeak > 0.97) for (let i = 0; i < length; i++) out[i] *= 0.97 / outPeak
  return out
}

const decoded = {}
const pieces = []
const index = { rate: RATE, kinds: {} }
let cursor = 0
for (const [kind, tiers] of Object.entries(BANK)) {
  index.kinds[kind] = tiers.map((variants, tier) => variants.map(([name, maxSec]) => {
    decoded[name] ??= null
    return { name, maxSec, tier }
  }))
}
for (const name of Object.keys(decoded)) decoded[name] = await source(name)
for (const [kind, tiers] of Object.entries(index.kinds)) {
  index.kinds[kind] = tiers.map((variants) => variants.map(({ name, maxSec, tier }) => {
    const pcm = cut(decoded[name], maxSec, tier)
    const start = cursor
    pieces.push(pcm, new Float32Array(Math.round(RATE * 0.02)))
    cursor += pcm.length + Math.round(RATE * 0.02)
    return { source: name, start, length: pcm.length }
  }))
}

const total = pieces.reduce((n, p) => n + p.length, 0)
const wav = Buffer.alloc(44 + total * 2)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(RATE, 24); wav.writeUInt32LE(RATE * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34)
wav.write('data', 36); wav.writeUInt32LE(total * 2, 40)
let o = 44
for (const p of pieces) for (const v of p) { wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), o); o += 2 }
writeFileSync(join(outDir, 'impact-bank.wav'), wav)
writeFileSync(join(outDir, 'impact-bank.json'), JSON.stringify(index, null, 2) + '\n')
console.log(`Wrote ${outDir}/impact-bank.wav (${(total / RATE).toFixed(2)} s, ${(wav.length / 1024).toFixed(0)} KB) + impact-bank.json`)
