import { impactLayers, type ImpactKind } from './ImpactModel'

/** Half a second of white noise per context for the one-shots. */
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

/**
 * Overall loudness of a full-strength hit (into the saturator below), and
 * of the scrape loop. A big crash is the loudest thing you hear: measured
 * through the master limiter, see AudioManager.impact for the engine duck.
 */
const HIT_GAIN = 2.2
const SCRAPE_GAIN = 4
/** Ignore a second hit on the same car sooner than this, s (one crash, not a burst of clicks). */
const RETRIGGER = 0.09
/** Panel ring partials, as ratios of a base that varies per hit (sheet metal is inharmonic). */
const RING_RATIOS = [1, 2.31, 3.87]

/**
 * One car's crash sounds: synthesized one-shots for hits (ImpactModel picks
 * the layers) and a looping scrape for grinding along a wall. Plays into
 * `destination` (the player's car bus, or a rival's 3D panner).
 */
export class ImpactSound {
  private readonly ctx: BaseAudioContext
  private readonly destination: AudioNode
  private readonly scrapeGain: GainNode
  private readonly scrapeBand: BiquadFilterNode
  private readonly scrapeSource: AudioBufferSourceNode
  private lastHit = -Infinity

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
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
    const grit = ctx.createWaveShaper()
    grit.curve = gritCurve()
    this.scrapeGain = ctx.createGain()
    this.scrapeGain.gain.value = 0
    this.scrapeSource.connect(this.scrapeBand).connect(grit).connect(this.scrapeGain).connect(destination)
    this.scrapeSource.start()
  }

  /** A hit of `strength` 0..1. */
  hit(kind: ImpactKind, strength: number): void {
    const t = this.ctx.currentTime
    if (strength <= 0 || t - this.lastHit < RETRIGGER) return
    this.lastHit = t
    const L = impactLayers(kind, strength)
    const level = HIT_GAIN * (0.25 + 0.75 * strength)
    const out = this.ctx.createGain()
    out.gain.value = level
    // Saturate the hit: a thud and ringing panels are peaky, and the limiter
    // caught their peaks long before they got loud. Clipped, the crash is
    // dense — far more energy under the same ceiling, and grittier.
    const drive = this.ctx.createWaveShaper()
    drive.curve = SATURATION
    drive.oversample = '2x'
    out.connect(drive).connect(this.destination)
    let end = t

    // Thud: a sine dropping in pitch, like a panel or a tyre absorbing the blow.
    const thud = this.ctx.createOscillator()
    thud.frequency.setValueAtTime(L.thudHz * 1.6, t)
    thud.frequency.exponentialRampToValueAtTime(L.thudHz * 0.6, t + L.thudDecay)
    const thudGain = this.envelope(t, L.thud * 0.9, 0.003, L.thudDecay)
    thud.connect(thudGain).connect(out)
    thud.start(t)
    thud.stop(t + L.thudDecay + 0.05)
    end = Math.max(end, t + L.thudDecay)

    // Crunch: a burst of noise through a band that sags as the metal gives.
    if (L.crunch > 0) {
      const src = this.noiseOneShot(t, L.crunchDecay + 0.05)
      const band = this.ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.Q.value = 0.9
      band.frequency.setValueAtTime(L.crunchHz * (0.85 + Math.random() * 0.3), t)
      band.frequency.exponentialRampToValueAtTime(L.crunchHz * 0.45, t + L.crunchDecay)
      src.connect(band).connect(this.envelope(t, L.crunch, 0.002, L.crunchDecay)).connect(out)
      end = Math.max(end, t + L.crunchDecay)
    }

    // Ring: the struck panel's inharmonic partials, dying away.
    if (L.ring > 0) {
      const base = 240 + Math.random() * 160
      RING_RATIOS.forEach((r, i) => {
        const osc = this.ctx.createOscillator()
        osc.frequency.value = base * r
        const decay = 0.35 / (1 + i * 0.6)
        osc.connect(this.envelope(t, (L.ring * 0.18) / (1 + i), 0.002, decay)).connect(out)
        osc.start(t)
        osc.stop(t + decay + 0.05)
        end = Math.max(end, t + decay)
      })
    }

    // Debris: plastic and glass skittering for a moment after a big one.
    if (L.debris > 0) {
      for (let k = 0; k < 3 + Math.round(L.debris * 4); k++) {
        const at = t + 0.03 + Math.random() * 0.18
        const src = this.noiseOneShot(at, 0.06)
        const high = this.ctx.createBiquadFilter()
        high.type = 'highpass'
        high.frequency.value = 3500 + Math.random() * 3000
        src.connect(high).connect(this.envelope(at, L.debris * 0.35 * Math.random(), 0.001, 0.04)).connect(out)
        end = Math.max(end, at + 0.06)
      }
    }
    // Let the graph go once it's done.
    setTimeout(() => {
      out.disconnect()
      drive.disconnect()
    }, (end - t + 0.3) * 1000)
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
  }

  private envelope(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack)
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay)
    return g
  }

  private noiseOneShot(t: number, length: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = noise(this.ctx)
    src.start(t, Math.random() * 0.4)
    src.stop(t + length)
    return src
  }
}

/** Soft clip for the hits: tanh(3x), normalised so full scale stays full scale. */
const SATURATION = (() => {
  const n = 2048
  const c = new Float32Array(new ArrayBuffer(n * 4))
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    c[i] = Math.tanh(x * 3) / Math.tanh(3)
  }
  return c
})()

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
