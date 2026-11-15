import { CarSoundModel, type CarSoundInput } from './CarSoundModel'
import { DEFAULT_VOICE, type EngineVoice } from './EngineVoice'
import { makeNoise, turboLift } from './TurboSounds'

export interface CarSoundState extends CarSoundInput {
  /** Nitro intensity, 0..~1.6. */
  nitro: number
}

/** Rpm that maps to full brightness/loudness. Roughly a road car's redline. */
const RPM_SCALE = 7500
/** How far ahead crackle pops are scheduled, seconds (covers a frame hitch). */
const LOOKAHEAD = 0.12
/** Make-up gain after the glue compressor (~+7.6 dB): the speaker tone below frees the room for it. */
const MAKEUP = 2.4
/** Speaker tone on the car bus (see the constructor): rumble high-pass, low shelf, body and presence. */
const RUMBLE_HZ = 40
const LOW_SHELF_DB = -5
const BODY_DB = 3
const PRESENCE_DB = 8
/** Every lift-off recording is levelled to this RMS before the car's own `liftOff`. */
const LIFT_OFF_RMS = 0.3

/**
 * The car's sound as a Web Audio graph on any BaseAudioContext (live or
 * offline for checks). The engine source (the recorded-engine worklet, or a
 * synth fallback) feeds two paths that mix on a compressed bus:
 *
 *   engine → lope ─┬─ intake: the clean recording, low-pass opening with throttle (leads the mix)
 *                  └─ exhaust: drive → gentle soft clip → boom + rasp EQ → air shelf
 *   + sub rumble (the half order), crank whine, turbo whistle and whoosh,
 *     overrun crackles, blow-off, shift "bwap", nitro whoosh and rush
 *
 * The car's EngineVoice sets the exhaust's resonances, drive and top end, the
 * crossplane lope, whine, turbos and pops, so cars that share a recording
 * still sound like themselves.
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
  private readonly lope: GainNode
  private readonly lopeLfo: OscillatorNode
  private readonly lopeDepth: GainNode
  private readonly drive: GainNode
  private readonly shaper: WaveShaperNode
  private readonly boom: BiquadFilterNode
  private readonly raspEq: BiquadFilterNode
  private readonly air: BiquadFilterNode
  private readonly whine: OscillatorNode
  private readonly whineGain: GainNode
  /** The whine's pure tone, and its airy bands (a blower's rush) at the fundamental and octave. */
  private readonly whineTone: GainNode
  private readonly whineAir: GainNode
  private readonly whineBand1: BiquadFilterNode
  private readonly whineBand2: BiquadFilterNode
  private readonly exhaustGain: GainNode
  private readonly sub: OscillatorNode
  private readonly subGain: GainNode
  private readonly whistle: OscillatorNode
  private readonly whistleGain: GainNode
  private readonly whooshGain: GainNode
  private readonly nitroRushGain: GainNode
  private readonly sources: AudioScheduledSourceNode[] = []

  private firingPerRev = 3
  private voice: EngineVoice = DEFAULT_VOICE
  private nextPopAt = 0
  /** Engine held silent until this time (ignition cranking). */
  private startAt = 0
  private liftOffClip: AudioBuffer | null = null
  private liftOffNorm = 1

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
    // Speaker tone, ahead of the compressor. The recordings are dark and the boom and sub
    // layers pile on bass: at full throttle ~60% of the bus sat under 150 Hz, which laptop
    // and phone speakers barely play, yet the compressor and limiters still turned the whole
    // car down for it. Trim the rumble and lift the presence band, so the room goes to what
    // you hear.
    const rumble = biquad(ctx, 'highpass', RUMBLE_HZ, 0.7, 0)
    const lows = biquad(ctx, 'lowshelf', 150, 0.7, LOW_SHELF_DB)
    const body = biquad(ctx, 'peaking', 650, 0.8, BODY_DB)
    const presence = biquad(ctx, 'peaking', 2000, 0.7, PRESENCE_DB)
    this.bus.connect(rumble).connect(lows).connect(body).connect(presence).connect(comp).connect(gain(ctx, MAKEUP)).connect(limiter).connect(out)

    this.engineIn = gain(ctx, 0)

    // Crossplane lope: the whole engine pulsed unevenly at the half order
    // (depth 0 for every engine that fires evenly).
    this.lope = gain(ctx, 1)
    this.lopeLfo = ctx.createOscillator()
    this.lopeLfo.type = 'sine'
    this.lopeDepth = gain(ctx, 0)
    this.lopeLfo.connect(this.lopeDepth).connect(this.lope.gain)
    this.engineIn.connect(this.lope)

    // Intake / mechanical: the clean recording, brighter on throttle.
    this.intakeFilter = ctx.createBiquadFilter()
    this.intakeFilter.type = 'lowpass'
    this.intakeFilter.Q.value = 0.7
    this.intakeGain = gain(ctx, 0.6)
    this.lope.connect(this.intakeFilter).connect(this.intakeGain).connect(this.bus)

    // Exhaust: driven into a soft clip for rasp, with the pipes' resonances.
    this.drive = gain(ctx, 1)
    this.shaper = ctx.createWaveShaper()
    this.shaper.curve = softClip(1.6) // warm, not fuzzy: the recording's own grit does the rest
    this.shaper.oversample = '2x'
    this.boom = biquad(ctx, 'peaking', 110, 1, 7)
    this.raspEq = biquad(ctx, 'peaking', 2400, 1.2, 0)
    this.air = biquad(ctx, 'highshelf', 4000, 0.7, 0)
    const tame = biquad(ctx, 'lowpass', 7000, 0.7, 0)
    this.exhaustGain = gain(ctx, 0)
    this.lope.connect(this.drive).connect(this.shaper).connect(this.boom).connect(this.raspEq).connect(this.air).connect(tame).connect(this.exhaustGain).connect(this.bus)

    // Crank whine: a supercharger's belt-driven scream or straight-cut gears.
    this.whine = ctx.createOscillator()
    this.whine.type = 'triangle'
    this.whineGain = gain(ctx, 0)
    this.whineGain.connect(this.bus)
    this.whineTone = gain(ctx, 1)
    this.whine.connect(biquad(ctx, 'highpass', 300, 0.7, 0)).connect(this.whineTone).connect(this.whineGain)
    // A blower's whine is air, not a beep: noise through narrow bands at the rotor pitch and its octave.
    const whineNoise = ctx.createBufferSource()
    whineNoise.buffer = this.noise
    whineNoise.loop = true
    this.whineBand1 = biquad(ctx, 'bandpass', 600, 16, 0)
    this.whineBand2 = biquad(ctx, 'bandpass', 1200, 16, 0)
    this.whineAir = gain(ctx, 0)
    const octave = gain(ctx, 0.45)
    whineNoise.connect(this.whineBand1).connect(this.whineAir)
    whineNoise.connect(this.whineBand2).connect(octave).connect(this.whineAir)
    // Narrow bands pass little energy: make it up so `air` 1 matches the tone's loudness.
    this.whineAir.connect(gain(ctx, 20)).connect(this.whineGain)
    whineNoise.start()
    this.sources.push(whineNoise)

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

    // Nitro rush: looping noise, band-passed. (Tyres and brakes: TyreBrakeSound.)
    this.nitroRushGain = gain(ctx, 0)
    this.loopNoise(0.9).connect(biquad(ctx, 'bandpass', 1700, 0.6, 0)).connect(this.nitroRushGain).connect(this.bus)

    this.sub.start()
    this.whistle.start()
    this.lopeLfo.start()
    this.whine.start()
    this.sources.push(this.sub, this.whistle, this.lopeLfo, this.whine)
  }

  /** The car's engine voice (see EngineVoice): its exhaust, character and pops. */
  setVoice(voice: EngineVoice): void {
    this.voice = voice
    // A supercharger's scream is bright and buzzy; straight-cut gears and gentler blowers hum.
    this.whine.type = voice.whine.scream ? 'sawtooth' : 'triangle'
    const air = Math.max(0, Math.min(1, voice.whine.air ?? 0))
    this.whineTone.gain.value = 1 - air
    this.whineAir.gain.value = air
    this.boom.frequency.value = voice.boomHz
    this.boom.gain.value = voice.boomDb
    this.raspEq.frequency.value = voice.raspHz
    this.air.gain.value = voice.airDb
    this.shaper.curve = softClip(1.6 * Math.sqrt(voice.drive))
  }

  /** Firing pulses per crank revolution (flat-six 3, V8 4), for the sub rumble's pitch. */
  setFiringPerRev(n: number): void {
    this.firingPerRev = n
  }

  /** The car's lift-off burble recording (optional). Levelled to LIFT_OFF_RMS: the recordings differ by ~6 dB. */
  setLiftOffClip(buffer: AudioBuffer | null): void {
    this.liftOffClip = buffer
    this.liftOffNorm = buffer ? clipNorm(buffer) : 1
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
  playClip(buffer: AudioBuffer, level: number, when = this.ctx.currentTime, rate = 1): void {
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rate
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
    const v = this.voice

    // Engine level: louder with rpm and load; dips for the upshift cut, swells on a blip.
    // Wide range from idle to redline: the rise of the revs is the drama.
    const level = running * ((0.45 + 0.55 * rpmT) * (1 - 0.5 * m.cut) + 0.12 * m.blip)
    set(this.engineIn.gain, level, t, running ? 0.015 : 0.01)
    set(this.intakeFilter.frequency, 2500 + on * 7000 + rpmT * 4000, t, 0.02)
    // The overrun (m.crackle: high on a lift, fading over ~1 s) holds the note up: lifting
    // used to drop the car ~4.5 dB at once (measured), so the burble and crackle sat in a hole.
    const overrun = m.crackle * (1 - on)
    set(this.intakeGain.gain, 0.7 + 0.35 * on + 0.3 * overrun, t, 0.025)
    set(this.drive.gain, (0.45 + 1.1 * on * (0.4 + 0.6 * rpmT) + 0.7 * overrun) * v.drive, t, 0.02)
    set(this.raspEq.gain, on * (1.5 + 3 * rpmT) * (v.raspDb / 4.5), t, 0.025)
    set(this.exhaustGain.gain, 0.1 + 0.22 * on + 0.08 * rpmT + 0.22 * overrun, t, 0.025)

    const halfOrder = (Math.max(m.rpm, 600) / 60) * (this.firingPerRev / 2) // the engine's half order
    set(this.sub.frequency, halfOrder, t, 0.03)
    set(this.subGain.gain, running * (0.05 + 0.1 * on) * (1 - 0.5 * rpmT) * v.sub, t, 0.08)
    // The lope is loudest at idle and part throttle, where a crossplane V8 burbles; it smooths out up top.
    set(this.lopeLfo.frequency, halfOrder, t, 0.03)
    set(this.lopeDepth.gain, 0.5 * v.burble * (1 - 0.6 * rpmT), t, 0.08)
    set(this.lope.gain, 1 - 0.5 * v.burble * (1 - 0.6 * rpmT), t, 0.08)
    const whineHz = (Math.max(m.rpm, 600) / 60) * v.whine.ratio
    set(this.whine.frequency, whineHz, t, 0.02)
    set(this.whineBand1.frequency, Math.max(40, whineHz), t, 0.02)
    set(this.whineBand2.frequency, Math.max(80, whineHz * 2), t, 0.02)
    set(this.whineGain.gain, running * v.whine.gain * (0.25 + 0.75 * on) * (0.3 + 0.7 * rpmT), t, 0.04)

    const w = v.whistle
    set(this.whistle.frequency, w ? w.lowHz + (w.highHz - w.lowHz) * m.spool : 2600 + 4200 * m.spool, t, 0.08)
    set(this.whistleGain.gain, 0.01 * m.spool * m.spool * (w ? w.gain : v.turbo), t, 0.06)
    set(this.whooshGain.gain, 0.03 * m.spool * v.turbo, t, 0.06)

    set(this.nitroRushGain.gain, 0.07 * Math.min(s.nitro, 1.6), t, 0.08)

    turboLift(this.ctx, this.noise, this.bus, t, m.blowOff, v)
    if (m.shiftUp) this.upshiftAt(t, rpmT)
    if (m.shiftDown) this.downshiftAt(t, rpmT)
    if (m.liftOff && this.liftOffClip) this.playClip(this.liftOffClip, (0.6 + 0.5 * rpmT) * this.liftOffNorm * (v.liftOff ?? 1), t, v.pitch)
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
    const p = this.voice.pops
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    // The car's pops: a deeper, longer thud for a big-bore V8, a sharp crack for a race six.
    const bp = biquad(ctx, 'bandpass', (big ? 500 + Math.random() * 400 : 1100 + Math.random() * 1600) * p.pitch, big ? 1.2 : 2.5, 0)
    const env = gain(ctx, 0)
    const len = (big ? 0.06 : 0.018 + Math.random() * 0.02) / Math.sqrt(p.pitch)
    env.gain.setValueAtTime(0, when)
    env.gain.linearRampToValueAtTime(level * (big ? 1.3 * p.bang : 0.9 * p.crackle), when + 0.002)
    env.gain.exponentialRampToValueAtTime(0.0001, when + len)
    src.connect(bp).connect(env).connect(this.bus)
    src.start(when, Math.random() * 1.5, len + 0.01)
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


/** Gain that brings a clip's RMS to LIFT_OFF_RMS, kept within ±12 dB. */
function clipNorm(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0)
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  const rms = Math.sqrt(sum / Math.max(1, data.length))
  return rms > 0 ? Math.min(4, Math.max(0.25, LIFT_OFF_RMS / rms)) : 1
}
