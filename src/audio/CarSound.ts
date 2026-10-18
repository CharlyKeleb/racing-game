import { CarSoundModel, type CarSoundInput } from './CarSoundModel'

export interface CarSoundState extends CarSoundInput {
  /** Max tire slip, 0..1 (squeal). */
  slip: number
  /** Nitro intensity, 0..~1.6. */
  nitro: number
}

/** Rpm that maps to full brightness/loudness. Roughly a road car's redline. */
const RPM_SCALE = 7500
/** How far ahead crackle pops are scheduled, seconds (covers a frame hitch). */
const LOOKAHEAD = 0.12
/** Make-up gain after the glue compressor (~+4.6 dB). */
const MAKEUP = 1.7

/**
 * The car's sound as a Web Audio graph on any BaseAudioContext (live or
 * offline for checks). The engine source (the recorded-engine worklet, or a
 * synth fallback) feeds two paths that mix on a compressed bus:
 *
 *   engine ─┬─ intake: the clean recording, low-pass opening with throttle (leads the mix)
 *           └─ exhaust: drive → gentle soft clip → boom (110 Hz) + rasp (2.4 kHz) EQ
 *   + sub rumble (flat-six half order), faint turbo whistle and whoosh,
 *     overrun crackles, blow-off, shift "bwap", nitro whoosh and rush, tire squeal
 *   → glue compressor → make-up gain → limiter → out
 *
 * The recording stays in front ("pure"): the synthetic layers only colour it.
 * Make-up gain brings the compressed bus up to a game-loud level and the
 * limiter keeps the peaks clear of clipping.
 *
 * CarSoundModel decides what happens; this class only maps it to nodes.
 */
export class CarSound {
  readonly engineIn: GainNode
  private readonly ctx: BaseAudioContext
  private readonly model = new CarSoundModel()
  private readonly bus: GainNode
  private readonly noise: AudioBuffer

  private readonly intakeFilter: BiquadFilterNode
  private readonly intakeGain: GainNode
  private readonly drive: GainNode
  private readonly raspEq: BiquadFilterNode
  private readonly exhaustGain: GainNode
  private readonly sub: OscillatorNode
  private readonly subGain: GainNode
  private readonly whistle: OscillatorNode
  private readonly whistleGain: GainNode
  private readonly whooshGain: GainNode
  private readonly nitroRushGain: GainNode
  private readonly squealGain: GainNode
  private readonly sources: AudioScheduledSourceNode[] = []

  private firingPerRev = 3
  private nextPopAt = 0
  /** Engine held silent until this time (ignition cranking). */
  private startAt = 0
  private liftOffClip: AudioBuffer | null = null

  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx
    this.noise = makeNoise(ctx)

    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -14
    comp.knee.value = 6
    comp.ratio.value = 3
    comp.attack.value = 0.006
    comp.release.value = 0.2
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -2
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.08
    this.bus = gain(ctx, 1)
    this.bus.connect(comp).connect(gain(ctx, MAKEUP)).connect(limiter).connect(out)

    this.engineIn = gain(ctx, 0)

    // Intake / mechanical: the clean recording, brighter on throttle.
    this.intakeFilter = ctx.createBiquadFilter()
    this.intakeFilter.type = 'lowpass'
    this.intakeFilter.Q.value = 0.7
    this.intakeGain = gain(ctx, 0.6)
    this.engineIn.connect(this.intakeFilter).connect(this.intakeGain).connect(this.bus)

    // Exhaust: driven into a soft clip for rasp, with the pipes' resonances.
    this.drive = gain(ctx, 1)
    const shaper = ctx.createWaveShaper()
    shaper.curve = softClip(1.6) // warm, not fuzzy: the recording's own grit does the rest
    shaper.oversample = '2x'
    const boom = biquad(ctx, 'peaking', 110, 1, 7)
    this.raspEq = biquad(ctx, 'peaking', 2400, 1.2, 0)
    const tame = biquad(ctx, 'lowpass', 7000, 0.7, 0)
    this.exhaustGain = gain(ctx, 0)
    this.engineIn.connect(this.drive).connect(shaper).connect(boom).connect(this.raspEq).connect(tame).connect(this.exhaustGain).connect(this.bus)

    // Sub rumble: a flat-six's strong half order (1.5 per rev), felt more than heard.
    this.sub = ctx.createOscillator()
    this.sub.type = 'sine'
    this.subGain = gain(ctx, 0)
    this.sub.connect(biquad(ctx, 'lowpass', 160, 0.7, 0)).connect(this.subGain).connect(this.bus)

    // Twin-turbo whistle and intake whoosh.
    this.whistle = ctx.createOscillator()
    this.whistle.type = 'sine'
    this.whistleGain = gain(ctx, 0)
    this.whistle.connect(this.whistleGain).connect(this.bus)
    this.whooshGain = gain(ctx, 0)
    this.loopNoise(0.3).connect(biquad(ctx, 'bandpass', 3600, 0.8, 0)).connect(this.whooshGain).connect(this.bus)

    // Nitro rush and tire squeal: looping noise, band-passed.
    this.nitroRushGain = gain(ctx, 0)
    this.loopNoise(0.9).connect(biquad(ctx, 'bandpass', 1700, 0.6, 0)).connect(this.nitroRushGain).connect(this.bus)
    this.squealGain = gain(ctx, 0)
    this.loopNoise(1.4).connect(biquad(ctx, 'bandpass', 1800, 6, 0)).connect(this.squealGain).connect(this.bus)

    this.sub.start()
    this.whistle.start()
    this.sources.push(this.sub, this.whistle)
  }

  /** Firing pulses per crank revolution (flat-six 3, V8 4), for the sub rumble's pitch. */
  setFiringPerRev(n: number): void {
    this.firingPerRev = n
  }

  /** The car's lift-off burble recording (optional). */
  setLiftOffClip(buffer: AudioBuffer | null): void {
    this.liftOffClip = buffer
  }

  /** Engine rpm as heard: rev inertia and shift dynamics applied (see CarSoundModel). */
  get engineRpm(): number {
    return this.model.rpm
  }

  /** Hold the engine silent until `time` (while the ignition clip cranks it). */
  holdEngineUntil(time: number): void {
    this.startAt = time
  }

  /** Plays a recorded one-shot through the bus. */
  playClip(buffer: AudioBuffer, level: number, when = this.ctx.currentTime): void {
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(gain(this.ctx, level)).connect(this.bus)
    src.start(when)
  }

  update(s: CarSoundState, dt: number): void {
    const t = this.ctx.currentTime
    const m = this.model
    m.update(s, dt)
    // Everything tonal follows the engine *as heard* (m.rpm, m.load): the model
    // already shapes rev inertia, the pedal, upshift cuts and downshift blips,
    // so the audio params only need a short glide between frames.
    const rpmT = Math.min(Math.max(m.rpm, 0) / RPM_SCALE, 1)
    const on = m.load
    const running = t >= this.startAt ? 1 : 0

    // Engine level: louder with rpm and load; dips for the upshift cut, swells on a blip.
    // Wide range from idle to redline: the rise of the revs is the drama.
    const level = running * ((0.45 + 0.55 * rpmT) * (1 - 0.5 * m.cut) + 0.12 * m.blip)
    set(this.engineIn.gain, level, t, running ? 0.015 : 0.01)
    set(this.intakeFilter.frequency, 2500 + on * 7000 + rpmT * 4000, t, 0.02)
    set(this.intakeGain.gain, 0.7 + 0.35 * on, t, 0.025)
    set(this.drive.gain, 0.45 + 1.1 * on * (0.4 + 0.6 * rpmT), t, 0.02)
    set(this.raspEq.gain, on * (1.5 + 3 * rpmT), t, 0.025)
    set(this.exhaustGain.gain, 0.1 + 0.22 * on + 0.08 * rpmT, t, 0.025)

    const halfOrder = (Math.max(m.rpm, 600) / 60) * (this.firingPerRev / 2) // the engine's half order
    set(this.sub.frequency, halfOrder, t, 0.03)
    set(this.subGain.gain, running * (0.05 + 0.1 * on) * (1 - 0.5 * rpmT), t, 0.08)

    set(this.whistle.frequency, 2600 + 4200 * m.spool, t, 0.08)
    set(this.whistleGain.gain, 0.01 * m.spool * m.spool, t, 0.06)
    set(this.whooshGain.gain, 0.03 * m.spool, t, 0.06)

    set(this.nitroRushGain.gain, 0.07 * Math.min(s.nitro, 1.6), t, 0.08)
    set(this.squealGain.gain, Math.min(Math.max(0, s.slip - 0.75) * 4, 1) * 0.2, t, 0.05)

    if (m.blowOff > 0) this.blowOffAt(t, m.blowOff)
    if (m.shiftUp) this.upshiftAt(t, rpmT)
    if (m.shiftDown) this.downshiftAt(t, rpmT)
    if (m.liftOff && this.liftOffClip) this.playClip(this.liftOffClip, 0.3 + 0.3 * rpmT)
    if (m.nitroStart) this.nitroWhooshAt(t)
    if (m.perfectStart) this.perfectBoomAt(t)
    this.scheduleCrackles(t, m.crackle)
  }

  // ── One-shots ───────────────────────────────────────────────────────────

  /** Overrun pops: short band-passed noise cracks at random intervals. */
  private scheduleCrackles(t: number, strength: number): void {
    if (strength < 0.03) {
      this.nextPopAt = t
      return
    }
    if (this.nextPopAt < t) this.nextPopAt = t
    while (this.nextPopAt < t + LOOKAHEAD) {
      const big = Math.random() < 0.18 * strength
      this.popAt(this.nextPopAt, strength * (big ? 1 : 0.35 + 0.4 * Math.random()), big)
      this.nextPopAt += (0.035 + Math.random() * 0.15) / (0.4 + strength)
    }
  }

  private popAt(when: number, level: number, big: boolean): void {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = biquad(ctx, 'bandpass', big ? 500 + Math.random() * 400 : 1100 + Math.random() * 1600, big ? 1.2 : 2.5, 0)
    const env = gain(ctx, 0)
    const len = big ? 0.06 : 0.018 + Math.random() * 0.02
    env.gain.setValueAtTime(0, when)
    env.gain.linearRampToValueAtTime(level * (big ? 0.9 : 0.6), when + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, when + len)
    src.connect(bp).connect(env).connect(this.bus)
    src.start(when, Math.random() * 1.5, len + 0.01)
  }

  /** Turbo blow-off valve: a bright "pssh" that fades over ~0.35 s. */
  private blowOffAt(when: number, strength: number): void {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const hp = biquad(ctx, 'highpass', 1800, 0.7, 0)
    const bp = biquad(ctx, 'bandpass', 4200, 0.9, 0)
    bp.frequency.setValueAtTime(4200, when)
    bp.frequency.exponentialRampToValueAtTime(2200, when + 0.35)
    const env = gain(ctx, 0)
    env.gain.setValueAtTime(0, when)
    env.gain.linearRampToValueAtTime(0.28 * strength, when + 0.012)
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.38)
    src.connect(hp).connect(bp).connect(env).connect(this.bus)
    src.start(when, Math.random(), 0.4)
  }

  /** Upshift: the model dips the note for the ignition cut; the pipes give one crack. */
  private upshiftAt(when: number, rpmT: number): void {
    this.popAt(when + 0.03, 0.35 + 0.35 * rpmT, true)
  }

  /**
   * Downshift: the model blips the revs to rev-match ("bwaap"); the hot exhaust
   * answers with a pop as the blip falls away, and a smaller one after.
   */
  private downshiftAt(when: number, rpmT: number): void {
    this.popAt(when + 0.06, 0.4 + 0.35 * rpmT, true)
    this.popAt(when + 0.1 + Math.random() * 0.03, 0.2 + 0.2 * rpmT, false)
  }

  /** Nitro kicks in: a rising whoosh. */
  private nitroWhooshAt(when: number): void {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = biquad(ctx, 'bandpass', 500, 1.1, 0)
    bp.frequency.setValueAtTime(500, when)
    bp.frequency.exponentialRampToValueAtTime(3800, when + 0.45)
    const env = gain(ctx, 0)
    env.gain.setValueAtTime(0, when)
    env.gain.linearRampToValueAtTime(0.4, when + 0.06)
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.75)
    src.connect(bp).connect(env).connect(this.bus)
    src.start(when, Math.random(), 0.8)
  }

  /** Perfect nitro: a low boom under a second whoosh. */
  private perfectBoomAt(when: number): void {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(120, when)
    osc.frequency.exponentialRampToValueAtTime(38, when + 0.4)
    const env = gain(ctx, 0)
    env.gain.setValueAtTime(0, when)
    env.gain.linearRampToValueAtTime(0.55, when + 0.01)
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.5)
    osc.connect(env).connect(this.bus)
    osc.start(when)
    osc.stop(when + 0.55)
    this.nitroWhooshAt(when)
  }

  private loopNoise(offset: number): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource()
    src.buffer = this.noise
    src.loop = true
    src.start(0, offset)
    this.sources.push(src)
    return src
  }

  reset(): void {
    this.model.reset()
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    this.bus.disconnect()
  }
}

function gain(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number, dB: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  f.gain.value = dB
  return f
}

function set(param: AudioParam, value: number, t: number, tau: number): void {
  param.setTargetAtTime(value, t, tau)
}

/** tanh soft clip; `k` sets how hard it bites. */
function softClip(k: number): Float32Array<ArrayBuffer> {
  const n = 1024
  const curve = new Float32Array(n)
  const norm = Math.tanh(k)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(k * x) / norm
  }
  return curve
}

function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
  return buffer
}
