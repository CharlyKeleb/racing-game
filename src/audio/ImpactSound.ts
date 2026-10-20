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

/**
 * One car's crash sounds: cached original procedural Foley one-shots and a looping scrape for grinding along a wall. Plays into
 * `destination` (the player's car bus, or a rival's 3D panner).
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
    const tier = s < .38 ? 0 : s < .76 ? 1 : 2
    source.buffer = this.bank.get(kind)![tier * 3 + this.variant++ % 3]
    source.playbackRate.value = .97 + Math.random() * .06
    gain.gain.value = HIT_GAIN * (.05 + .95 * s ** .85)
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
