import { Howler } from 'howler'
import { decodeWav16, type EngineBank } from './GranularEngine'
import type { EngineBankMessage } from './engineWorklet'
import engineWorkletUrl from './engineWorklet.ts?worker&url'

/** Rpm that maps to full brightness/loudness. Roughly a road car's redline. */
const RPM_SCALE = 7500
/** Ignition clip: when the engine has caught and settled, seconds. */
const IGNITION_SETTLE = 1.5

/**
 * Engine and tire audio.
 *
 * The engine is the car's own recordings when it ships an audio bank
 * (public/audio/<car>/: engine-bank.wav + .json, ignition.mp3, lift-off.mp3),
 * synthesized per firing pulse in an AudioWorklet (see GranularEngine).
 * Throttle opens a low-pass and raises the level, so lifting sounds like
 * engine braking. Until the bank loads, or if it can't, a procedural engine
 * plays instead, so the car is never silent.
 * Howler owns the global volume/unlock so one-shot SFX share the same mixer.
 */
export class AudioManager {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private carAudioUrl: string | null = null

  // Procedural fallback engine.
  private engineOsc!: OscillatorNode
  private engineSub!: OscillatorNode
  private engineFilter!: BiquadFilterNode
  private engineGain!: GainNode

  // Recorded engine.
  private sampled: AudioWorkletNode | null = null
  private sampledFilter!: BiquadFilterNode
  private sampledGain!: GainNode
  private ignition: AudioBuffer | null = null
  private liftOff: AudioBuffer | null = null
  private loading: Promise<void> | null = null
  /** Engine is held silent until this context time (ignition is cranking). */
  private engineStartAt = 0
  private prevThrottle = 0
  private liftOffReadyAt = 0

  private squealGain!: GainNode
  private squealFilter!: BiquadFilterNode

  /** Base URL of the car's audio folder, e.g. '/audio/porsche911/'; null = procedural only. */
  setCarAudio(url: string | undefined): void {
    this.carAudioUrl = url ?? null
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(volume: number): void {
    if (this.ctx) {
      void this.ctx.resume()
      return
    }
    const ctx = Howler.ctx ?? new AudioContext()
    this.ctx = ctx
    void ctx.resume()

    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    this.setVolume(volume)

    this.engineFilter = ctx.createBiquadFilter()
    this.engineFilter.type = 'lowpass'
    this.engineFilter.Q.value = 4
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.engineFilter.connect(this.engineGain).connect(this.master)

    this.engineOsc = ctx.createOscillator()
    this.engineOsc.type = 'sawtooth'
    this.engineSub = ctx.createOscillator()
    this.engineSub.type = 'square'
    this.engineOsc.connect(this.engineFilter)
    this.engineSub.connect(this.engineFilter)
    this.engineOsc.start()
    this.engineSub.start()

    this.sampledFilter = ctx.createBiquadFilter()
    this.sampledFilter.type = 'lowpass'
    this.sampledFilter.Q.value = 0.7
    this.sampledGain = ctx.createGain()
    this.sampledGain.gain.value = 0
    this.sampledFilter.connect(this.sampledGain).connect(this.master)

    // Looping white noise, band-passed, for tire squeal.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = buffer
    noise.loop = true
    this.squealFilter = ctx.createBiquadFilter()
    this.squealFilter.type = 'bandpass'
    this.squealFilter.frequency.value = 1800
    this.squealFilter.Q.value = 6
    this.squealGain = ctx.createGain()
    this.squealGain.gain.value = 0
    noise.connect(this.squealFilter).connect(this.squealGain).connect(this.master)
    noise.start()

    this.loading = this.loadCarAudio(ctx)
  }

  private async loadCarAudio(ctx: AudioContext): Promise<void> {
    const base = this.carAudioUrl
    if (!base) return
    try {
      const fetchBuffer = async (name: string) => {
        const res = await fetch(base + name)
        if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
        return res.arrayBuffer()
      }
      const [wav, manifest, ignition, liftOff] = await Promise.all([
        fetchBuffer('engine-bank.wav'),
        fetchBuffer('engine-bank.json'),
        fetchBuffer('ignition.mp3').catch(() => null),
        fetchBuffer('lift-off.mp3').catch(() => null),
        ctx.audioWorklet.addModule(engineWorkletUrl),
      ])
      const bank = JSON.parse(new TextDecoder().decode(manifest)) as EngineBank
      // Parsed by hand: decodeAudioData would resample and shift the pitch marks.
      const { pcm } = decodeWav16(wav)
      if (ignition) this.ignition = await ctx.decodeAudioData(ignition)
      if (liftOff) this.liftOff = await ctx.decodeAudioData(liftOff)

      const node = new AudioWorkletNode(ctx, 'granular-engine', { numberOfInputs: 0, outputChannelCount: [1] })
      const msg: EngineBankMessage = { pcm, bank }
      node.port.postMessage(msg, [pcm.buffer])
      node.connect(this.sampledFilter)
      this.sampled = node
    } catch (err) {
      console.warn('[AudioManager] car audio unavailable, using the procedural engine', err)
    }
  }

  /** Race start: crank the engine. The loop fades in once it has caught. */
  playStart(): void {
    const ctx = this.ctx
    if (!ctx) return
    void (this.loading ?? Promise.resolve()).then(() => {
      if (!this.ignition) return
      this.oneShot(this.ignition, 0.9)
      this.engineStartAt = ctx.currentTime + IGNITION_SETTLE
    })
  }

  private oneShot(buffer: AudioBuffer, gain: number): void {
    const ctx = this.ctx!
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const g = ctx.createGain()
    g.gain.value = gain
    src.connect(g).connect(this.master)
    src.start()
  }

  setVolume(volume: number): void {
    Howler.volume(volume)
    if (this.master) this.master.gain.value = volume * 0.5
  }

  /** @param rpm engine rpm, @param throttle 0..1, @param slip max tire slip 0..1 */
  update(rpm: number, throttle: number, slip: number): void {
    const ctx = this.ctx
    if (!ctx) return
    const t = ctx.currentTime
    const rpmT = Math.min(rpm / RPM_SCALE, 1)
    const running = t >= this.engineStartAt ? 1 : 0

    if (this.sampled) {
      const params = this.sampled.parameters
      params.get('rpm')!.setTargetAtTime(rpm, t, 0.025)
      // On throttle: open and loud. Off: muffled overrun, quieter.
      this.sampledFilter.frequency.setTargetAtTime(900 + throttle * 7000 + rpmT * 4000, t, 0.06)
      this.sampledGain.gain.setTargetAtTime(running * (0.55 + 0.35 * throttle + 0.35 * rpmT), t, running ? 0.08 : 0.01)
      this.engineGain.gain.setTargetAtTime(0, t, 0.05)

      // Lifting off high in the revs: a burble from the exhaust.
      if (this.liftOff && this.prevThrottle > 0.6 && throttle < 0.15 && rpm > 4200 && t > this.liftOffReadyAt) {
        this.oneShot(this.liftOff, 0.35 + 0.35 * rpmT)
        this.liftOffReadyAt = t + 2
      }
    } else {
      // Flat-six firing frequency = rpm/60 * 3.
      const fire = (rpm / 60) * 3
      this.engineOsc.frequency.setTargetAtTime(fire, t, 0.03)
      this.engineSub.frequency.setTargetAtTime(fire / 2, t, 0.03)
      this.engineFilter.frequency.setTargetAtTime(400 + throttle * 2200 + rpm * 0.15, t, 0.05)
      this.engineGain.gain.setTargetAtTime(running * (0.18 + throttle * 0.22), t, 0.05)
    }
    this.prevThrottle = throttle

    const squeal = Math.max(0, slip - 0.75) * 4
    this.squealGain.gain.setTargetAtTime(Math.min(squeal, 1) * 0.25, t, 0.05)
  }

  suspend(): void {
    void this.ctx?.suspend()
  }

  resume(): void {
    void this.ctx?.resume()
  }

  dispose(): void {
    this.engineOsc?.stop()
    this.engineSub?.stop()
    this.sampled?.disconnect()
    this.sampled?.port.close()
    this.master?.disconnect()
    if (this.ctx && this.ctx !== Howler.ctx) void this.ctx.close()
    this.ctx = null
  }
}
