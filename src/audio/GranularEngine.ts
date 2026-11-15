/**
 * Recorded-engine synthesizer. Pure — no Web Audio types — so it runs inside
 * an AudioWorklet and in unit tests alike.
 *
 * Recordings of real cars rarely hold a steady high rpm, so plain looping and
 * speeding up a sample sounds like a chipmunk past ~1.5x. Instead this uses
 * pitch-synchronous overlap-add (PSOLA): the bank stores short steady segments
 * with a pitch mark on every firing pulse, and each output pulse is one
 * Hann-windowed two-period grain of the real recording, spaced at the target
 * firing period. Pitch follows rpm while the exhaust's timbre is kept.
 * The two layers nearest in rpm are crossfaded with equal power.
 */

export interface EngineBankLayer {
  name: string
  /** Rpm the segment was recorded at. */
  rpm: number
  /** Offset and length of the segment in the bank's PCM, samples. */
  start: number
  length: number
  /** Firing-pulse positions relative to `start`, ascending. */
  marks: number[]
}

export interface EngineBank {
  sampleRate: number
  /** Firing pulses per crankshaft revolution (flat-six: 3). */
  firingPerRev: number
  layers: EngineBankLayer[]
  /**
   * A loop bank (make_engine_loop.py): the whole PCM is one seamless loop recorded at this rpm.
   * The player's car plays it as recorded, its speed following the rpm; `layers` still lets
   * rivals play it through GranularEngine.
   */
  loop?: { rpm: number }
}

const MAX_GRAINS = 48
/**
 * Longest grain, in target firing periods (each side of the pulse). Short
 * enough that a recording carried ~4× above its rpm (the V8 bank tops out at
 * ~1900) still sounds at the new firing rate rather than its own ringing.
 */
const MAX_GRAIN_PERIODS = 0.8
/** Never stretch a grain's loudness more than this when spacing them wider. */
const MAX_NORMALIZE = 1.5
/**
 * Furthest a grain is spaced below its recording's pitch before it's also slowed down.
 * A grain is two source periods long; spaced further apart than that they leave gaps:
 * at idle (~840 rpm) the V8 bank (lowest recording ~1840 rpm) was near-silent 34% of
 * the time, a choppy, broken idle. Past this ratio the grain plays slower (and darker,
 * as a real idle is), so the grains still overlap.
 */
const MAX_SPACING = 1.3
/**
 * Furthest a grain is packed above its recording's pitch before it's also sped up. Packed
 * tighter, a grain (cut to MAX_GRAIN_PERIODS) holds under one of the recording's own firing
 * cycles: at ~3x up a 911 grain held 0.4 of one, mostly window shape, and the sound sank
 * below its own firing note (spectral centroid 0.4x f0) into a dull buzz as it revved.
 * Past this ratio it plays faster (brighter, as a high-revving engine is), so each grain
 * carries a whole cycle of the real engine. MAX_SPEEDUP caps the chipmunk.
 */
const MAX_PACKING = 1.5
const MAX_SPEEDUP = 2.5

export class GranularEngine {
  private readonly pcm: Float32Array
  private readonly layers: EngineBankLayer[]
  private readonly firingPerRev: number
  private readonly outRate: number
  /** Source samples per output sample (bank rate / context rate). */
  private readonly step: number
  /**
   * Where each layer's grains are read from, in pitch marks (fractional), and which way it walks.
   * It moves through the recording at the recording's own pace, whatever the target rpm, and
   * bounces at the ends: stepping one mark per grain ran a 0.3 s segment through in under 0.1 s
   * at 3-4x its rpm and jumped back to its start, a ~12 Hz flutter with a click on every jump.
   */
  private readonly cursor: Float64Array
  private readonly dir: Int8Array
  /** Small deterministic random walk so a bounce never repeats exactly. */
  private seed = 0x9e3779b9
  // Grain pool, struct-of-arrays so render() never allocates.
  private readonly gSrc = new Float64Array(MAX_GRAINS)
  private readonly gLen = new Float64Array(MAX_GRAINS)
  private readonly gAge = new Float64Array(MAX_GRAINS)
  private readonly gGain = new Float32Array(MAX_GRAINS)
  /** Playback rate through the source, 1 = its own speed (below 1 only far below the recording). */
  private readonly gRate = new Float64Array(MAX_GRAINS)
  private readonly gLive = new Uint8Array(MAX_GRAINS)
  private untilNext = 0

  constructor(pcm: Float32Array, bank: EngineBank, outRate: number) {
    this.pcm = pcm
    this.layers = [...bank.layers].sort((a, b) => a.rpm - b.rpm)
    this.firingPerRev = bank.firingPerRev
    this.outRate = outRate
    this.step = bank.sampleRate / outRate
    this.cursor = new Float64Array(this.layers.length).fill(1)
    this.dir = new Int8Array(this.layers.length).fill(1)
  }

  /**
   * Fills `out` with engine sound at `rpm`. Allocation-free.
   * @param gain overall level, 0..1
   */
  render(out: Float32Array, rpm: number, gain = 1): void {
    const period = this.outRate / (Math.max(rpm, 300) / 60) / this.firingPerRev
    const pcm = this.pcm
    for (let n = 0; n < out.length; n++) {
      if (this.untilNext <= 0) {
        this.spawn(rpm, period, gain)
        this.untilNext += period
      }
      this.untilNext--

      let acc = 0
      for (let g = 0; g < MAX_GRAINS; g++) {
        if (!this.gLive[g]) continue
        const age = this.gAge[g]
        const len = this.gLen[g]
        if (age >= len) {
          this.gLive[g] = 0
          continue
        }
        const pos = this.gSrc[g] + age * this.step * this.gRate[g]
        const i = pos | 0
        const frac = pos - i
        const s = pcm[i] + (pcm[i + 1] - pcm[i]) * frac
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * age) / len)
        acc += s * w * this.gGain[g]
        this.gAge[g] = age + 1
      }
      out[n] = acc
    }
  }

  /** Starts one grain from each of the (up to two) layers nearest `rpm`. */
  private spawn(rpm: number, period: number, gain: number): void {
    const layers = this.layers
    let hi = 0
    while (hi < layers.length && layers[hi].rpm < rpm) hi++
    if (hi === 0) {
      this.spawnFrom(0, period, gain)
    } else if (hi === layers.length) {
      this.spawnFrom(hi - 1, period, gain)
    } else {
      // Crossfade in log-rpm, equal power.
      const a = layers[hi - 1].rpm
      const b = layers[hi].rpm
      const t = Math.log(rpm / a) / Math.log(b / a)
      this.spawnFrom(hi - 1, period, gain * Math.cos((t * Math.PI) / 2))
      this.spawnFrom(hi, period, gain * Math.sin((t * Math.PI) / 2))
    }
  }

  private spawnFrom(li: number, period: number, gain: number): void {
    if (gain < 0.01) return
    const layer = this.layers[li]
    const marks = layer.marks
    const last = marks.length - 2
    let pos = this.cursor[li]
    if (!(pos >= 1 && pos <= last)) pos = 1
    // One mark of jitter either way breaks the bounce's period.
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
    const jitter = this.seed / 4294967296 < 0.5 ? 0 : (this.seed & 1 ? 1 : -1)
    const c = Math.max(1, Math.min(last, Math.round(pos) + jitter))
    // Two source periods around the mark, played at the source's own speed.
    // Pitching far up, the grain is cut to a few target periods: otherwise its
    // own ringing outweighs the new firing rate and the pitch goes vague.
    const before = marks[c] - marks[c - 1]
    const after = marks[c + 1] - marks[c]
    const srcPeriodOut = (before + after) / 2 / this.step
    // Far below the recording, slow the grain down so it still spans MAX_SPACING's overlap;
    // far above it, speed it up so it still holds a whole firing cycle (MAX_PACKING).
    const ratio = srcPeriodOut / period
    const rate = ratio < 1 ? Math.min(1, MAX_SPACING * ratio) : Math.min(MAX_SPEEDUP, Math.max(1, ratio / MAX_PACKING))
    // Advance by real time: a target period's worth of the source, never more than a mark.
    let next = pos + this.dir[li] * Math.min(1, (period * rate) / srcPeriodOut)
    if (next >= last) { next = last; this.dir[li] = -1 } else if (next <= 1) { next = 1; this.dir[li] = 1 }
    this.cursor[li] = last <= 1 ? 1 : next
    // A sped-up grain's source periods pass faster: cap on its heard length, not the source's.
    const lenOut = rate > 1 ? 2 * Math.min(srcPeriodOut / rate, MAX_GRAIN_PERIODS * period) : (2 * Math.min(srcPeriodOut, MAX_GRAIN_PERIODS * period)) / rate
    // Hann grains at hop = period sum to (len / period) / 2; scale that back to 1.
    const normalize = Math.min(MAX_NORMALIZE, period / (lenOut / 2))

    let g = 0
    let oldest = 0
    for (; g < MAX_GRAINS; g++) {
      if (!this.gLive[g]) break
      if (this.gAge[g] > this.gAge[oldest]) oldest = g
    }
    if (g === MAX_GRAINS) g = oldest
    this.gLive[g] = 1
    this.gAge[g] = 0
    this.gLen[g] = lenOut
    this.gSrc[g] = layer.start + marks[c] - (lenOut / 2) * this.step * rate
    this.gGain[g] = gain * normalize
    this.gRate[g] = rate
  }

  /** Grains currently sounding (for tests and debugging). */
  get activeGrains(): number {
    let n = 0
    for (let g = 0; g < MAX_GRAINS; g++) n += this.gLive[g]
    return n
  }
}

/** Parses a 16-bit PCM mono/stereo WAV into mono floats, without resampling. */
export function decodeWav16(buffer: ArrayBuffer): { pcm: Float32Array; sampleRate: number } {
  const view = new DataView(buffer)
  const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file')
  let channels = 1
  let sampleRate = 44100
  let offset = 12
  while (offset + 8 <= view.byteLength) {
    const id = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ') {
      if (view.getUint16(body, true) !== 1 || view.getUint16(body + 14, true) !== 16) throw new Error('need 16-bit PCM')
      channels = view.getUint16(body + 2, true)
      sampleRate = view.getUint32(body + 4, true)
    } else if (id === 'data') {
      const frames = Math.floor(size / 2 / channels)
      // +1 guard sample so render()'s linear interpolation never reads past the end.
      const pcm = new Float32Array(frames + 1)
      for (let i = 0; i < frames; i++) pcm[i] = view.getInt16(body + i * 2 * channels, true) / 32768
      return { pcm, sampleRate }
    }
    offset = body + size + (size & 1)
  }
  throw new Error('WAV has no data chunk')
}
