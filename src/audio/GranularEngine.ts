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

export class GranularEngine {
  private readonly pcm: Float32Array
  private readonly layers: EngineBankLayer[]
  private readonly firingPerRev: number
  private readonly outRate: number
  /** Source samples per output sample (bank rate / context rate). */
  private readonly step: number
  /** Next pitch-mark index per layer; grains walk through each segment in order. */
  private readonly cursor: Int32Array
  // Grain pool, struct-of-arrays so render() never allocates.
  private readonly gSrc = new Float64Array(MAX_GRAINS)
  private readonly gLen = new Float64Array(MAX_GRAINS)
  private readonly gAge = new Float64Array(MAX_GRAINS)
  private readonly gGain = new Float32Array(MAX_GRAINS)
  private readonly gLive = new Uint8Array(MAX_GRAINS)
  private untilNext = 0

  constructor(pcm: Float32Array, bank: EngineBank, outRate: number) {
    this.pcm = pcm
    this.layers = [...bank.layers].sort((a, b) => a.rpm - b.rpm)
    this.firingPerRev = bank.firingPerRev
    this.outRate = outRate
    this.step = bank.sampleRate / outRate
    this.cursor = new Int32Array(this.layers.length).fill(1)
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
        const pos = this.gSrc[g] + age * this.step
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
    let c = this.cursor[li]
    if (c < 1 || c >= marks.length - 1) c = 1
    this.cursor[li] = c + 1 >= marks.length - 1 ? 1 : c + 1

    // Two source periods around the mark, played at the source's own speed.
    // Pitching far up, the grain is cut to a few target periods: otherwise its
    // own ringing outweighs the new firing rate and the pitch goes vague.
    const before = marks[c] - marks[c - 1]
    const after = marks[c + 1] - marks[c]
    const srcPeriodOut = (before + after) / 2 / this.step
    const lenOut = 2 * Math.min(srcPeriodOut, MAX_GRAIN_PERIODS * period)
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
    this.gSrc[g] = layer.start + marks[c] - (lenOut / 2) * this.step
    this.gGain[g] = gain * normalize
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
