import { Howler } from 'howler'
import { CarSound, type CarSoundState } from './CarSound'
import { OpponentAudio } from './OpponentAudio'
import { GarageAmbience } from './GarageAmbience'
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
  private rivals: OpponentAudio[] = []
  private bankCache = new Map<string, Promise<EngineBankMessage>>()
  private workletReady: Promise<void> | null = null
  private engineBank: EngineBankMessage | null = null
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
  /** The car's sound runs through this, so the menu can hold the engine quiet. */
  private carBus!: GainNode
  private ambience: GarageAmbience | null = null
  /** 'menu' = garage room tone, engine held quiet (except a swap's rev); 'race' = engine up, room tone out. */
  private scene: 'menu' | 'race' = 'menu'
  private menuEngine = false
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
    this.engineBank = null
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
    this.carBus = ctx.createGain()
    this.carBus.connect(this.master)
    this.sound = new CarSound(ctx, this.carBus)
    this.ambience = new GarageAmbience(ctx, this.master)
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
    this.applyMix()
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
        this.workletReady ??= ctx.audioWorklet.addModule(engineWorkletUrl),
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
      node.port.postMessage(msg)
      // The car may have changed while this loaded.
      if (this.carAudioUrl !== base) {
        node.port.close()
        return
      }
      this.engineBank = msg
      this.bankCache.set(base, Promise.resolve(msg))
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

  /** Menu/garage vs. on track: sets the room tone and whether the engine is heard. */
  setScene(scene: 'menu' | 'race'): void {
    this.scene = scene
    this.applyMix()
  }

  /** In the menu, let the engine be heard (a car swap revs out and rolls in). */
  setMenuEngine(on: boolean): void {
    if (on === this.menuEngine) return
    this.menuEngine = on
    this.applyMix()
  }

  private applyMix(): void {
    const ctx = this.ctx
    if (!ctx || !this.carBus) return
    const engine = this.scene === 'race' || this.menuEngine ? 1 : 0
    this.carBus.gain.setTargetAtTime(engine, ctx.currentTime, 0.12)
    this.ambience?.setLevel(this.scene === 'menu' ? 1 : 0)
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

  clearOpponents(): void {
    for (const rival of this.rivals) rival.dispose()
    this.rivals = []
  }

  setOpponentCars(cars: readonly { audioUrl?: string; firingPerRev: number }[]): void {
    this.clearOpponents()
    const ctx = this.ctx
    if (!ctx) return
    for (const car of cars) {
      const rival = new OpponentAudio(ctx, this.master, car.firingPerRev)
      this.rivals.push(rival)
      const base = car.audioUrl
      if (!base) continue
      let bank = this.bankCache.get(base)
      if (!bank && base === this.carAudioUrl && this.engineBank) bank = Promise.resolve(this.engineBank)
      if (!bank) {
        bank = (async () => {
          const [wav, manifest] = await Promise.all([
            fetch(base + 'engine-bank.wav').then(r => { if (!r.ok) throw new Error('Engine recording unavailable'); return r.arrayBuffer() }),
            fetch(base + 'engine-bank.json').then(r => { if (!r.ok) throw new Error('Engine bank unavailable'); return r.json() as Promise<EngineBank> }),
            this.workletReady ??= ctx.audioWorklet.addModule(engineWorkletUrl),
          ])
          return { pcm: decodeWav16(wav).pcm, bank: manifest }
        })()
        this.bankCache.set(base, bank)
      }
      void bank.then(recording => {
        if (this.rivals.includes(rival)) rival.setBank(recording)
      }).catch(() => this.bankCache.delete(base))
    }
  }

  updateOpponent(index: number, rpm: number, throttle: number, distance: number, lateral: number, active: boolean): void {
    this.rivals[index]?.update(rpm, throttle, distance, lateral, active)
  }

  dispose(): void {
    this.clearOpponents()
    this.engineBank = null
    this.bankCache.clear()
    this.sound?.dispose()
    this.ambience?.dispose()
    this.sampled?.disconnect()
    this.sampled?.port.close()
    this.master?.disconnect()
    if (this.ctx && this.ctx !== Howler.ctx) void this.ctx.close()
    this.ctx = null
  }
}
