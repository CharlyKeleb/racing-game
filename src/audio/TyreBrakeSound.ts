import { type CarNoiseProfile, type TyreBrakeLevels } from './TyreBrakeModel'

/** Two seconds of white noise per context, shared by every car's loops. */
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>()
function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx)
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    noiseBuffers.set(ctx, buf)
  }
  return buf
}

/** Relative strength of the squeal's three ring modes and where they sit. */
const MODES: readonly { ratio: number; q: number; level: number }[] = [
  { ratio: 1, q: 22, level: 1 },
  { ratio: 1.93, q: 16, level: 0.55 },
  { ratio: 2.76, q: 12, level: 0.3 },
]
/**
 * Overall loudness of each part at full level (before the car's bus).
 * Measured in game: a launch's wheelspin and a hard corner's squeal had come
 * up level with the engine (−12 dB against −13) and buried it. The engine
 * leads, as in an arcade racer: a full slide now sits ~10 dB under it.
 */
const SQUEAL_GAIN = 1.4
const SCRUB_GAIN = 0.3
const HISS_GAIN = 0.1
const GRIND_GAIN = 0.3
const BRAKE_SQUEAL_GAIN = 0.08
const RUMBLE_GAIN = 0.9

/**
 * One car's tyres and brakes as a Web Audio graph (see TyreBrakeModel for
 * what each part is): squeal as noise through three narrow resonances that
 * wander in pitch, broadband scrub, pad hiss, race-pad grind amplitude-
 * modulated at the disc's pass rate, and a low-speed brake squeal tone.
 * Everything starts silent and follows `update`.
 */
export class TyreBrakeSound {
  readonly output: GainNode
  private readonly ctx: BaseAudioContext
  private profile: CarNoiseProfile
  private readonly sources: AudioScheduledSourceNode[] = []
  private readonly modes: BiquadFilterNode[] = []
  private readonly squealGain: GainNode
  /** Tremolo for the ABS chatter; depth via absDepth. */
  private readonly flutter: OscillatorNode
  private readonly absDepth: GainNode
  private readonly scrub: BiquadFilterNode
  private readonly scrubGain: GainNode
  private readonly hiss: BiquadFilterNode
  private readonly hissGain: GainNode
  private readonly grindRate: OscillatorNode
  private readonly grindGain: GainNode
  private readonly grindAm: GainNode
  private readonly brakeTone: OscillatorNode
  private readonly brakeToneGain: GainNode
  private readonly rumble: OscillatorNode
  private readonly rumbleGain: GainNode
  /** Slow random walk of the squeal pitch, ±~4%: real squeal never holds one note. */
  private wander = 0
  private wanderVelocity = 0

  constructor(ctx: BaseAudioContext, profile: CarNoiseProfile) {
    this.ctx = ctx
    this.profile = profile
    this.output = ctx.createGain()

    const loop = () => {
      const src = ctx.createBufferSource()
      src.buffer = noise(ctx)
      src.loop = true
      // Start each loop somewhere different so the parts don't correlate.
      src.start(0, Math.random() * 1.9)
      this.sources.push(src)
      return src
    }

    // Squeal: noise → three resonances → gain (with an ABS tremolo on top).
    const squealNoise = loop()
    this.squealGain = ctx.createGain()
    this.squealGain.gain.value = 0
    const tremolo = ctx.createGain()
    tremolo.gain.value = 1
    this.flutter = ctx.createOscillator()
    this.flutter.frequency.value = 14
    this.absDepth = ctx.createGain()
    this.absDepth.gain.value = 0
    this.flutter.connect(this.absDepth).connect(tremolo.gain)
    this.flutter.start()
    this.sources.push(this.flutter)
    for (const m of MODES) {
      const f = ctx.createBiquadFilter()
      f.type = 'bandpass'
      f.Q.value = m.q
      f.frequency.value = profile.tyres.squealHz * m.ratio
      const g = ctx.createGain()
      // A narrow band-pass passes little energy: make it up so the modes are heard.
      g.gain.value = m.level * Math.sqrt(m.q) * 0.9
      squealNoise.connect(f).connect(g).connect(this.squealGain)
      this.modes.push(f)
    }
    this.squealGain.connect(tremolo).connect(this.output)

    // Scrub: broadband rubber noise.
    this.scrub = ctx.createBiquadFilter()
    this.scrub.type = 'bandpass'
    this.scrub.Q.value = 0.7
    this.scrub.frequency.value = profile.tyres.scrubHz
    this.scrubGain = ctx.createGain()
    this.scrubGain.gain.value = 0
    loop().connect(this.scrub).connect(this.scrubGain).connect(this.output)

    // Brake pad hiss.
    this.hiss = ctx.createBiquadFilter()
    this.hiss.type = 'bandpass'
    this.hiss.Q.value = 1.4
    this.hiss.frequency.value = profile.brakes.hissHz
    this.hissGain = ctx.createGain()
    this.hissGain.gain.value = 0
    loop().connect(this.hiss).connect(this.hissGain).connect(this.output)

    // Race pad grind: low-mid noise, rasping at the disc's pass rate.
    const grindBand = ctx.createBiquadFilter()
    grindBand.type = 'bandpass'
    grindBand.Q.value = 2.5
    grindBand.frequency.value = 520
    this.grindGain = ctx.createGain()
    this.grindGain.gain.value = 0
    this.grindAm = ctx.createGain()
    this.grindAm.gain.value = 0.5
    this.grindRate = ctx.createOscillator()
    this.grindRate.type = 'sawtooth'
    this.grindRate.frequency.value = 20
    const amDepth = ctx.createGain()
    amDepth.gain.value = 0.5
    this.grindRate.connect(amDepth).connect(this.grindAm.gain)
    this.grindRate.start()
    this.sources.push(this.grindRate)
    loop().connect(grindBand).connect(this.grindAm).connect(this.grindGain).connect(this.output)

    // Kerb rumble: the tyre slapping over each ridge — a buzzy low tone at the
    // ridge rate, plus tyre noise chopped at the same rate.
    this.rumble = ctx.createOscillator()
    this.rumble.type = 'sawtooth'
    this.rumble.frequency.value = 60
    const rumbleLow = ctx.createBiquadFilter()
    rumbleLow.type = 'lowpass'
    rumbleLow.frequency.value = 380
    this.rumbleGain = ctx.createGain()
    this.rumbleGain.gain.value = 0
    this.rumble.connect(rumbleLow).connect(this.rumbleGain)
    const slap = ctx.createGain()
    slap.gain.value = 0
    const slapDepth = ctx.createGain()
    slapDepth.gain.value = 0.6
    this.rumble.connect(slapDepth).connect(slap.gain)
    const slapBand = ctx.createBiquadFilter()
    slapBand.type = 'bandpass'
    slapBand.frequency.value = 300
    slapBand.Q.value = 1.2
    loop().connect(slapBand).connect(slap).connect(this.rumbleGain)
    this.rumbleGain.connect(this.output)
    this.rumble.start()
    this.sources.push(this.rumble)

    // Low-speed brake squeal: a high tone with a little vibrato.
    this.brakeTone = ctx.createOscillator()
    this.brakeTone.frequency.value = profile.brakes.squealHz || 3000
    const vibrato = ctx.createOscillator()
    vibrato.frequency.value = 6.5
    const vibratoDepth = ctx.createGain()
    vibratoDepth.gain.value = (profile.brakes.squealHz || 3000) * 0.006
    vibrato.connect(vibratoDepth).connect(this.brakeTone.frequency)
    this.brakeToneGain = ctx.createGain()
    this.brakeToneGain.gain.value = 0
    this.brakeTone.connect(this.brakeToneGain).connect(this.output)
    this.brakeTone.start()
    vibrato.start()
    this.sources.push(this.brakeTone, vibrato)
  }

  /** Swap the car (the player picked another): new resonances, hiss and squeal. */
  setProfile(profile: CarNoiseProfile): void {
    this.profile = profile
    this.scrub.frequency.value = profile.tyres.scrubHz
    this.hiss.frequency.value = profile.brakes.hissHz
    this.brakeTone.frequency.value = profile.brakes.squealHz || 3000
  }

  /** Follow the model. `pitch` multiplies every frequency (doppler for a rival). */
  update(levels: TyreBrakeLevels, dt: number, pitch = 1): void {
    const t = this.ctx.currentTime
    // Squeal pitch wanders a few percent, faster when the car slides harder.
    this.wanderVelocity += (Math.random() - 0.5) * dt * 6 - this.wander * dt * 3
    this.wanderVelocity *= Math.exp(-dt * 2)
    this.wander = Math.max(-0.04, Math.min(0.04, this.wander + this.wanderVelocity * dt))
    const base = this.profile.tyres.squealHz * levels.squealPitch * (1 + this.wander) * pitch
    MODES.forEach((m, i) => this.modes[i].frequency.setTargetAtTime(base * m.ratio, t, 0.03))

    this.squealGain.gain.setTargetAtTime(levels.squeal * SQUEAL_GAIN, t, 0.04)
    this.absDepth.gain.setTargetAtTime(levels.abs * 0.9, t, 0.03)
    this.scrubGain.gain.setTargetAtTime(levels.scrub * SCRUB_GAIN, t, 0.05)
    this.scrub.frequency.setTargetAtTime(this.profile.tyres.scrubHz * pitch, t, 0.05)
    this.hissGain.gain.setTargetAtTime(levels.brakeHiss * HISS_GAIN, t, 0.06)
    this.hiss.frequency.setTargetAtTime(this.profile.brakes.hissHz * pitch, t, 0.06)
    this.grindGain.gain.setTargetAtTime(levels.grind * GRIND_GAIN, t, 0.05)
    this.grindRate.frequency.setTargetAtTime(Math.max(2, levels.grindRate), t, 0.05)
    this.brakeToneGain.gain.setTargetAtTime(levels.brakeSqueal * BRAKE_SQUEAL_GAIN, t, 0.08)
    this.rumble.frequency.setTargetAtTime(Math.max(10, levels.kerbRate * pitch), t, 0.03)
    this.rumbleGain.gain.setTargetAtTime(levels.kerbRumble * RUMBLE_GAIN, t, 0.03)
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
      s.disconnect()
    }
    this.output.disconnect()
  }
}
