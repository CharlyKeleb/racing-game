import { makeImpactPCM } from './ImpactPCM'
import type { ImpactKind } from './ImpactModel'

/** Shared noise bed for the continuous wall scrape. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()
function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx)
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseBuffers.set(ctx, buf)
  }
  return buf
}

const HIT_GAIN = 1.25
/** Recorded hits are loudness-matched per tier in the bank; this sets their level in the mix. */
const RECORDED_GAIN = 1
/** Hit strength where the light → medium → heavy tiers change. */
const TIER_EDGES = [0, .38, .76, 1]
const SCRAPE_GAIN = 1.1
const RETRIGGER = .1
const banks = new WeakMap<BaseAudioContext, Map<ImpactKind, AudioBuffer[]>>()
function impactBank(ctx: BaseAudioContext): Map<ImpactKind, AudioBuffer[]> {
  let bank = banks.get(ctx)
  if (bank) return bank
  bank = new Map()
  for (const kind of ['car', 'wall', 'ground', 'curb'] as const) {
    const samples: AudioBuffer[] = []
    for (const strength of [.25, .6, 1]) for (let variant = 0; variant < 3; variant++) {
      const pcm = makeImpactPCM(kind, strength, 731 + variant * 271, ctx.sampleRate)
      const buffer = ctx.createBuffer(1, pcm.length, ctx.sampleRate)
      buffer.copyToChannel(pcm, 0)
      samples.push(buffer)
    }
    bank.set(kind, samples)
  }
  banks.set(ctx, bank)
  return bank
}

/** Where each recorded hit sits in impact-bank.wav (scripts/audio/build-impact-bank.mjs writes it). */
export interface ImpactBankIndex {
  rate: number
  /** kind → tiers (light, medium, heavy) → variants. Positions in samples at `rate`. */
  kinds: Partial<Record<ImpactKind, { source: string; start: number; length: number }[][]>>
}

/** Recorded hits per context: kind → tier → variant buffers. Empty until loaded. */
const recordings = new WeakMap<BaseAudioContext, Map<ImpactKind, AudioBuffer[][]>>()

/**
 * Cut the decoded bank into one buffer per hit. `decoded` may have been
 * resampled to the context's rate, so positions are scaled from the index's.
 */
export function sliceImpactBank(ctx: BaseAudioContext, decoded: AudioBuffer, index: ImpactBankIndex): Map<ImpactKind, AudioBuffer[][]> {
  const scale = decoded.sampleRate / index.rate
  const data = decoded.getChannelData(0)
  const bank = new Map<ImpactKind, AudioBuffer[][]>()
  for (const [kind, tiers] of Object.entries(index.kinds) as [ImpactKind, ImpactBankIndex['kinds'][ImpactKind]][]) {
    if (!tiers || tiers.length !== 3 || tiers.some((v) => v.length === 0)) continue
    bank.set(kind, tiers.map((variants) => variants.map(({ start, length }) => {
      const from = Math.round(start * scale), n = Math.max(1, Math.min(data.length - from, Math.round(length * scale)))
      const buffer = ctx.createBuffer(1, n, decoded.sampleRate)
      buffer.copyToChannel(data.subarray(from, from + n), 0)
      return buffer
    })))
  }
  return bank
}

/**
 * Load the recorded crash bank (CC0 Freesound, see public/audio/impacts/CREDITS.md).
 * Until it arrives, or if it fails, hits use the procedural Foley.
 */
export async function loadImpactRecordings(ctx: BaseAudioContext, base = '/audio/impacts/'): Promise<boolean> {
  if (recordings.has(ctx)) return true
  try {
    const [wav, index] = await Promise.all([
      fetch(base + 'impact-bank.wav').then((r) => { if (!r.ok) throw new Error(`impact bank: HTTP ${r.status}`); return r.arrayBuffer() }),
      fetch(base + 'impact-bank.json').then((r) => { if (!r.ok) throw new Error(`impact index: HTTP ${r.status}`); return r.json() as Promise<ImpactBankIndex> }),
    ])
    const decoded = await ctx.decodeAudioData(wav)
    recordings.set(ctx, sliceImpactBank(ctx, decoded, index))
    return true
  } catch {
    return false
  }
}

/**
 * One car's crash sounds: recorded car/wall hits when the bank has loaded (procedural Foley before that, and for landings
 * and kerbs), plus a looping scrape for grinding along a wall. Plays into `destination` (the player's car bus, or a
 * rival's 3D panner).
 */
export class ImpactSound {
  private readonly ctx: BaseAudioContext
  private readonly destination: AudioNode
  private readonly scrapeGain: GainNode
  private readonly scrapeBand: BiquadFilterNode
  private readonly scrapeSource: AudioBufferSourceNode
  private lastHit = -Infinity
  private lastStrength = 0
  private lastKind: ImpactKind = 'curb'
  private readonly bank: Map<ImpactKind, AudioBuffer[]>
  private readonly voices = new Map<AudioBufferSourceNode, GainNode>()
  private readonly scrapeGrit: WaveShaperNode
  private variant = 0

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.bank = impactBank(ctx)
    this.ctx = ctx
    this.destination = destination
    // Scrape: grinding metal/plastic on concrete — gritty mid noise, its band
    // jittering with the contact. Silent until `scrape` raises it.
    this.scrapeSource = ctx.createBufferSource()
    this.scrapeSource.buffer = noise(ctx)
    this.scrapeSource.loop = true
    this.scrapeBand = ctx.createBiquadFilter()
    this.scrapeBand.type = 'bandpass'
    this.scrapeBand.Q.value = 1.8
    this.scrapeBand.frequency.value = 1600
    const grit = this.scrapeGrit = ctx.createWaveShaper()
    grit.curve = gritCurve()
    this.scrapeGain = ctx.createGain()
    this.scrapeGain.gain.value = 0
    this.scrapeSource.connect(this.scrapeBand).connect(grit).connect(this.scrapeGain).connect(destination)
    this.scrapeSource.start()
  }

  /** A hit of `strength` 0..1. */
  hit(kind: ImpactKind, strength: number): boolean {
    const t = this.ctx.currentTime
    const s = Math.max(0, Math.min(1, strength))
    if (s <= 0) return false
    // A kerb must not swallow a subsequent crash, but resting contacts must
    // not turn into a machine-gun of one-shots.
    if (t - this.lastHit < RETRIGGER && kind === 'curb' && this.lastKind !== 'curb') return false
    if (t - this.lastHit < RETRIGGER && !(this.lastKind === 'curb' && kind !== 'curb') && s < this.lastStrength + .2) return false
    if (this.voices.size >= 6) return false
    this.lastHit = t; this.lastStrength = s; this.lastKind = kind
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain()
    const tier = s < TIER_EDGES[1] ? 0 : s < TIER_EDGES[2] ? 1 : 2
    const recorded = recordings.get(this.ctx)?.get(kind)?.[tier]
    if (recorded) {
      // Real hits: the tier sets the weight, strength within it the level; vary pitch so repeats don't sound copied.
      source.buffer = recorded[this.variant++ % recorded.length]
      source.playbackRate.value = .94 + Math.random() * .12
      const within = (s - TIER_EDGES[tier]) / (TIER_EDGES[tier + 1] - TIER_EDGES[tier])
      gain.gain.value = RECORDED_GAIN * (.55 + .45 * within)
    } else {
      source.buffer = this.bank.get(kind)![tier * 3 + this.variant++ % 3]
      source.playbackRate.value = .97 + Math.random() * .06
      gain.gain.value = HIT_GAIN * (.05 + .95 * s ** .85)
    }
    source.connect(gain).connect(this.destination)
    this.voices.set(source, gain)
    source.onended = () => { source.disconnect(); gain.disconnect(); this.voices.delete(source) }
    source.start(t)
    return true
  }

  /** Grinding along a wall, 0..1 (follow every frame; 0 = silent). */
  scrape(level: number, slidingSpeed: number): void {
    const t = this.ctx.currentTime
    this.scrapeGain.gain.setTargetAtTime(level * SCRAPE_GAIN, t, level > 0 ? 0.02 : 0.08)
    // Faster sliding, higher grind; a little jitter for the uneven contact.
    this.scrapeBand.frequency.setTargetAtTime((900 + slidingSpeed * 45) * (0.9 + Math.random() * 0.2), t, 0.03)
  }

  dispose(): void {
    this.scrapeSource.stop()
    this.scrapeSource.disconnect()
    this.scrapeGain.disconnect()
    this.scrapeBand.disconnect()
    this.scrapeGrit.disconnect()
    for (const [source, gain] of this.voices) { source.onended = null; source.stop(); source.disconnect(); gain.disconnect() }
    this.voices.clear()
  }
}

/** A hard-ish clip that roughens the scrape noise into a grind. */
function gritCurve(): Float32Array<ArrayBuffer> {
  const n = 1024
  const c = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(x * 3) * 0.8
  }
  return c
}
