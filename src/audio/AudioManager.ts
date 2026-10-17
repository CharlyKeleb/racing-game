import { Howler } from 'howler'
import { CarSound, type CarSoundState } from './CarSound'
import { decodeWav16, type EngineBank } from './GranularEngine'
import type { EngineBankMessage } from './engineWorklet'
import engineWorkletUrl from './engineWorklet.ts?worker&url'

/** Ignition clip: when the engine has caught and settled, seconds. */
const IGNITION_SETTLE = 1.5

export type { CarSoundState }

/**
 * Owns the AudioContext and the car's sound (CarSound).
 *
 * The engine source is the car's own recordings when it ships an audio bank
 * (public/audio/<car>/: engine-bank.wav + .json, ignition.mp3, lift-off.mp3),
 * synthesized per firing pulse in an AudioWorklet (see GranularEngine). Until
 * the bank loads, or if it can't, a synth stands in, so the car is never
 * silent. Either way it runs through CarSound's exhaust chain.
 * Howler owns the global volume/unlock so one-shot SFX share the same mixer.
 */
export class AudioManager {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private sound: CarSound | null = null
  private carAudioUrl: string | null = null
  /** Firing pulses per crank revolution (flat-six 3, V8 4): pitches the synth and sub. */
  private firingPerRev = 3

  // Synth stand-in until the recordings load.
  private synthSaw!: OscillatorNode
  private synthSquare!: OscillatorNode
  private synthGain!: GainNode

  private sampled: AudioWorkletNode | null = null
  private ignition: AudioBuffer | null = null
  private loading: Promise<void> | null = null
  private lastTime = 0
  /** True while the game is paused; otherwise the context must stay running. */
  private paused = false
  private resumeTriedAt = -Infinity

  constructor() {
    // Howler suspends its AudioContext 30 s after load (and after each of its
    // own sounds ends) when no Howl is playing. This game borrows that context
    // for the engine and never plays a Howl, so the engine went silent mid-race.
    Howler.autoSuspend = false
  }

  /**
   * The car's audio folder, e.g. '/audio/porsche911/' (undefined = synth only),
   * and its firing pulses per revolution. Switching cars after unlock swaps
   * the engine: the synth covers the gap while the new recordings load.
   */
  setCarAudio(url: string | undefined, firingPerRev = 3): void {
    const next = url ?? null
    const changed = next !== this.carAudioUrl
    this.carAudioUrl = next
    this.firingPerRev = firingPerRev
    this.sound?.setFiringPerRev(firingPerRev)
    if (!changed || !this.ctx || !this.sound) return
    this.sampled?.disconnect()
    this.sampled?.port.close()
    this.sampled = null
    this.ignition = null
    this.sound.setLiftOffClip(null)
    this.synthGain.gain.value = 0.35
    this.loading = this.loadCarAudio(this.ctx, this.sound)
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(volume: number): void {
    this.paused = false
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
    this.sound = new CarSound(ctx, this.master)
    this.sound.setFiringPerRev(this.firingPerRev)

    this.synthGain = ctx.createGain()
    this.synthGain.gain.value = 0.35
    this.synthGain.connect(this.sound.engineIn)
    this.synthSaw = ctx.createOscillator()
    this.synthSaw.type = 'sawtooth'
    this.synthSquare = ctx.createOscillator()
    this.synthSquare.type = 'square'
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 900
    this.synthSaw.connect(tone)
    this.synthSquare.connect(tone)
    tone.connect(this.synthGain)
    this.synthSaw.start()
    this.synthSquare.start()

    this.loading = this.loadCarAudio(ctx, this.sound)
  }

  private async loadCarAudio(ctx: AudioContext, sound: CarSound): Promise<void> {
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
      // The one-shots are optional: a car without them (or a dev server that
      // answers a missing file with index.html) still gets its recorded engine.
      const decode = (buf: ArrayBuffer | null) => (buf ? ctx.decodeAudioData(buf).catch(() => null) : Promise.resolve(null))
      this.ignition = await decode(ignition)
      sound.setLiftOffClip(await decode(liftOff))

      const node = new AudioWorkletNode(ctx, 'granular-engine', { numberOfInputs: 0, outputChannelCount: [1] })
      const msg: EngineBankMessage = { pcm, bank }
      node.port.postMessage(msg, [pcm.buffer])
      // The car may have changed while this loaded.
      if (this.carAudioUrl !== base) {
        node.port.close()
        return
      }
      node.connect(sound.engineIn)
      this.sampled = node
      // The synth keeps running silently: it's the stand-in again if the car changes.
      this.synthGain.gain.value = 0
    } catch (err) {
      console.warn('[AudioManager] car audio unavailable, using the synth engine', err)
    }
  }

  /** Race start: crank the engine. The loop fades in once it has caught. */
  playStart(): void {
    const ctx = this.ctx
    if (!ctx) return
    this.sound?.reset()
    void (this.loading ?? Promise.resolve()).then(() => {
      if (!this.ignition || !this.sound) return
      this.sound.playClip(this.ignition, 0.9)
      this.sound.holdEngineUntil(ctx.currentTime + IGNITION_SETTLE)
    })
  }

  setVolume(volume: number): void {
    Howler.volume(volume)
    // CarSound's make-up gain and limiter set the loudness; 0.9 keeps ~1 dB of
    // headroom at full volume (redline peaks ≈ −1 dBFS, measured offline).
    if (this.master) this.master.gain.value = volume * 0.9
  }

  update(state: CarSoundState): void {
    const ctx = this.ctx
    if (!ctx || !this.sound) return
    // Self-heal if anything else suspends the context while racing (another
    // library, the OS taking audio focus). Retry at most once a second.
    if (ctx.state !== 'running' && !this.paused) {
      const now = performance.now()
      if (now - this.resumeTriedAt > 1000) {
        this.resumeTriedAt = now
        void ctx.resume()
      }
    }
    const t = ctx.currentTime
    const dt = Math.min(Math.max(t - this.lastTime, 0), 0.1)
    this.lastTime = t

    // The sound model turns the physics rpm into the engine as heard (rev
    // inertia, shift glides, rev-match blips); pitch follows that.
    this.sound.update(state, dt)
    const rpm = this.sound.engineRpm
    if (this.sampled) {
      this.sampled.parameters.get('rpm')!.setTargetAtTime(rpm, t, 0.01)
    } else {
      // Firing frequency = rpm/60 × pulses per rev (flat-six 3, V8 4).
      const fire = (Math.max(rpm, 600) / 60) * this.firingPerRev
      this.synthSaw.frequency.setTargetAtTime(fire, t, 0.012)
      this.synthSquare.frequency.setTargetAtTime(fire / 2, t, 0.012)
    }
  }

  suspend(): void {
    this.paused = true
    void this.ctx?.suspend()
  }

  resume(): void {
    this.paused = false
    void this.ctx?.resume()
  }

  dispose(): void {
    this.sound?.dispose()
    this.sampled?.disconnect()
    this.sampled?.port.close()
    this.master?.disconnect()
    if (this.ctx && this.ctx !== Howler.ctx) void this.ctx.close()
    this.ctx = null
  }
}
