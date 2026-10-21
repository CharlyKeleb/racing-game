import { narrationMix, NARRATION_GAME_LEVEL } from './narrationMix'
import { TracksideAmbience } from './TracksideAmbience'
import type { SpotterCue } from '../racing/ProximityRadar'
import type { TracksideEmitter } from '../world/atmospherePlan'
import type { Camera } from 'three'
import { DrivingSound } from './DrivingSound'
import { Howler } from 'howler'
import { CarSound, type CarSoundState } from './CarSound'
import { OpponentAudio, type RivalSoundState } from './OpponentAudio'
import { TyreBrakeSound } from './TyreBrakeSound'
import { ImpactSound, loadImpactRecordings } from './ImpactSound'
import type { ImpactKind } from './ImpactModel'
import { DEFAULT_NOISE_PROFILE, tyreBrakeLevels, type CarNoiseProfile, type TyreBrakeInput } from './TyreBrakeModel'
import { GarageAmbience } from './GarageAmbience'
import { MenuMusic } from './MenuMusic'
import { MUSIC_TRACKS, musicTrack } from './musicTracks'
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
  private readonly spotterVoices=new Set<OscillatorNode>()
  /** Cancel pending cue tones too, so pause/reset never leaves a queued warning. */
  clearSpotter():void {
    for(const voice of this.spotterVoices){voice.stop();voice.disconnect()}
    this.spotterVoices.clear()
  }
  playSpotter(cue:SpotterCue):void {
    const ctx=this.ctx
    if(!ctx||this.paused||ctx.state!=='running')return
    this.clearSpotter()
    const clear=cue.startsWith('clear'),pan=cue.includes('left')||cue==='left'?-.7:cue.includes('right')||cue==='right'?.7:0
    for(let i=0;i<2;i++){
      const tone=ctx.createOscillator(),gain=ctx.createGain(),stereo=ctx.createStereoPanner(),time=ctx.currentTime+i*.1
      tone.type='sine';tone.frequency.value=clear?650+i*280:cue==='both'?400:490
      stereo.pan.value=pan;gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(.15,time+.012);gain.gain.exponentialRampToValueAtTime(.0001,time+.12)
      tone.connect(gain).connect(stereo).connect(this.fxBus);this.spotterVoices.add(tone)
      tone.onended=()=>{tone.disconnect();gain.disconnect();stereo.disconnect();this.spotterVoices.delete(tone)}
      tone.start(time);tone.stop(time+.14)
    }
  }
  private rivals: OpponentAudio[] = []
  private rivalNoise: CarNoiseProfile[] = []
  /** Reused for every rival's update (no per-frame allocation). */
  private readonly rivalState: RivalSoundState = { rpm: 0, throttle: 0, x: 0, y: 0, z: 0, recession: 0, passSpeed: 0, active: false, tyres: tyreBrakeLevels({ speed: 0, brake: 0, slip: 0, slide: 0, paved: 0, drifting: false, kerb: 0 }, DEFAULT_NOISE_PROFILE) }
  private bankCache = new Map<string, Promise<EngineBankMessage>>()
  private workletReady: Promise<void> | null = null
  private engineBank: EngineBankMessage | null = null
  private ctx: AudioContext | null = null
  private master!: GainNode
  /** Last stage before the speakers (see unlock). */
  private limiter: DynamicsCompressorNode | null = null
  private sound: CarSound | null = null
  private carAudioUrl: string | null = null
  /** Firing pulses per crank revolution (flat-six 3, V8 4): pitches the synth and sub. */
  private firingPerRev = 3
  /** The player's tyres and brakes, and what they're made of. */
  private tyres: TyreBrakeSound | null = null
  private impacts: ImpactSound | null = null
  private driving: DrivingSound | null = null
  private trackside: TracksideAmbience | null = null
  private tracksideAreas: readonly TracksideEmitter[] | undefined
  /** Dips the player's engine and tyres under a crash. */
  private duck!: GainNode
  private fxBus!: GainNode
  private noiseProfile: CarNoiseProfile = DEFAULT_NOISE_PROFILE

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
  /** Menu/garage soundtrack; created on unlock with the rest of the graph. */
  private music: MenuMusic | null = null
  private musicTrackId: string = MUSIC_TRACKS[0].id
  private musicEnabled = true
  /** Audible playback state for the UI; false while autoplay is blocked or muted. */
  onMenuMusicState: ((playing: boolean) => void) | null = null
  /** 'menu' = garage room tone, engine held quiet (except a swap's rev); 'race' = engine up, room tone out. */
  private scene: 'menu' | 'race' = 'menu'
  private finishMix = false
  private menuEngine = false
  /** True while the game is paused; otherwise the context must stay running. */
  private paused = false
  private resumeTriedAt = -Infinity
  /** One second of white noise for the intro whooshes and impacts, made on first use. */
  private noise: AudioBuffer | null = null

  private volume = 1
  private mixTarget: number | null = null
  private readonly unsubscribeNarration: () => void

  constructor() {
    this.unsubscribeNarration = narrationMix.subscribe(() => this.applyNarrationMix())
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
  setCarAudio(url: string | undefined, firingPerRev = 3, noise: CarNoiseProfile = DEFAULT_NOISE_PROFILE): void {
    this.noiseProfile = noise
    this.tyres?.setProfile(noise)
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
      // A blocked first play left the element paused; this gesture unblocks it.
      this.music?.retry()
      return
    }
    const ctx = Howler.ctx ?? new AudioContext()
    this.ctx = ctx
    void ctx.resume()

    this.master = ctx.createGain()
    // Brickwall limiter on the whole mix: a crash on top of the engine and the
    // rivals peaked ~7 dB over full scale (measured) and would clip.
    const limiter = (this.limiter = ctx.createDynamicsCompressor())
    limiter.threshold.value = -1.5
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.12
    this.master.connect(limiter).connect(ctx.destination)
    this.setVolume(volume)
    this.carBus = ctx.createGain()
    // Engine and tyres duck under a crash (see impact), so the hit cuts
    // through instead of being squashed into the engine by the limiter.
    this.duck = ctx.createGain()
    this.carBus.connect(this.duck).connect(this.master)
    // The player's crashes bypass the car bus: they mustn't duck themselves,
    // and the menu holding the engine quiet mustn't mute them.
    this.fxBus = ctx.createGain()
    this.fxBus.connect(this.master)
    this.sound = new CarSound(ctx, this.carBus)
    this.tyres = new TyreBrakeSound(ctx, this.noiseProfile)
    this.tyres.output.connect(this.carBus)
    this.impacts = new ImpactSound(ctx, this.fxBus)
    void loadImpactRecordings(ctx)
    this.driving = new DrivingSound(ctx, this.carBus)
    this.ambience = new GarageAmbience(ctx, this.master)
    this.music = new MenuMusic(ctx, this.master, (playing) => this.onMenuMusicState?.(playing))
    this.music.setTrack(musicTrack(this.musicTrackId))
    this.music.setEnabled(this.musicEnabled)
    this.music.setActive(this.scene === 'menu')
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

  private noiseSource(ctx: AudioContext): AudioBufferSourceNode {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const data = this.noise.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    }
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    return src
  }

  /** Intro whip-pan: a band of noise swept up through the cut, `lead` seconds before it lands. */
  playWhoosh(lead: number): void {
    const ctx = this.ctx
    if (!ctx || this.paused) return
    const t = ctx.currentTime, end = t + lead * 2.4
    const src = this.noiseSource(ctx)
    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.Q.value = 1.4
    band.frequency.setValueAtTime(300, t)
    band.frequency.exponentialRampToValueAtTime(3200, t + lead)
    band.frequency.exponentialRampToValueAtTime(500, end)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.5, t + lead)
    gain.gain.exponentialRampToValueAtTime(0.0001, end)
    src.connect(band).connect(gain).connect(this.master)
    src.start(t)
    src.stop(end + 0.05)
  }

  /** Lands a shot: a sub thump with a short burst of low noise. */
  playImpact(weight = 1): void {
    const ctx = this.ctx
    if (!ctx || this.paused) return
    const t = ctx.currentTime
    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(120, t)
    sub.frequency.exponentialRampToValueAtTime(38, t + 0.45)
    const subGain = ctx.createGain()
    subGain.gain.setValueAtTime(0.0001, t)
    subGain.gain.exponentialRampToValueAtTime(0.7 * weight, t + 0.012)
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6)
    sub.connect(subGain).connect(this.master)
    sub.start(t)
    sub.stop(t + 0.65)
    const src = this.noiseSource(ctx)
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 900
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.35 * weight, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    src.connect(low).connect(gain).connect(this.master)
    src.start(t)
    src.stop(t + 0.2)
  }

  /**
   * Race callout chime (#90): short, original, and quiet under the engine.
   * Rising for gains, falling for losing the lead, a two-tone bell for the final lap.
   */
  playCallout(kind: 'overtake' | 'lead' | 'lostLead' | 'finalLap' | 'finish', volume: number): void {
    const ctx = this.ctx
    if (!ctx || this.paused || volume <= 0 || kind === 'finish') return
    const notes = kind === 'lead' ? [587, 740, 880] : kind === 'overtake' ? [660, 880] : kind === 'lostLead' ? [660, 494] : [988, 740, 988, 740]
    const step = kind === 'finalLap' ? .14 : .09
    notes.forEach((frequency, i) => {
      const time = ctx.currentTime + i * step
      const tone = ctx.createOscillator(), gain = ctx.createGain()
      tone.type = kind === 'finalLap' ? 'triangle' : 'sine'; tone.frequency.value = frequency
      gain.gain.setValueAtTime(.0001, time)
      gain.gain.exponentialRampToValueAtTime(.1 * volume, time + .01)
      gain.gain.exponentialRampToValueAtTime(.0001, time + .22)
      tone.connect(gain).connect(this.fxBus)
      tone.onended = () => { tone.disconnect(); gain.disconnect() }
      tone.start(time); tone.stop(time + .24)
    })
  }

  /** A small rising interval for a bank/transition, falling for a broken chain. */
  playDriftCue(kind: 'bank' | 'link' | 'bust'): void {
    const ctx = this.ctx
    if (!ctx || this.paused) return
    const frequencies = kind === 'bust' ? [260, 160] : kind === 'bank' ? [660, 880, 1320] : [880, 1100]
    frequencies.forEach((frequency, i) => {
      const time = ctx.currentTime + i * .075
      const tone = ctx.createOscillator(), gain = ctx.createGain()
      tone.type = 'sine'; tone.frequency.value = frequency
      gain.gain.setValueAtTime(.0001,time)
      gain.gain.exponentialRampToValueAtTime(.12,time+.008)
      gain.gain.exponentialRampToValueAtTime(.0001,time+.2)
      tone.connect(gain).connect(this.master)
      tone.onended = () => { tone.disconnect(); gain.disconnect() }
      tone.start(time); tone.stop(time+.22)
    })
  }

  /** Short original finish sting: a low hit and a restrained rising chord. */
  playFinish(victory: boolean): void {
    const ctx = this.ctx
    if (!ctx || this.paused) return
    this.playImpact(.35)
    const notes = victory ? [196, 246.94, 293.66, 392] : [146.83, 196, 220, 293.66]
    notes.forEach((hz, i) => {
      const at = ctx.currentTime + .08 + i * .11
      const tone = ctx.createOscillator(), gain = ctx.createGain(), filter = ctx.createBiquadFilter()
      tone.type = 'triangle'; tone.frequency.value = hz
      filter.type = 'lowpass'; filter.frequency.value = 1900; filter.Q.value = .5
      gain.gain.setValueAtTime(.0001, at)
      gain.gain.exponentialRampToValueAtTime(.11, at + .014)
      gain.gain.exponentialRampToValueAtTime(.0001, at + 1.1)
      tone.connect(filter).connect(gain).connect(this.master)
      tone.onended = () => { tone.disconnect(); filter.disconnect(); gain.disconnect() }
      tone.start(at); tone.stop(at + 1.15)
    })
  }

  /** Start gantry: a short tone per red light, a long high one at lights out. */
  playStartLight(go: boolean): void {
    const ctx = this.ctx
    if (!ctx || this.paused) return
    const t = ctx.currentTime, length = go ? 0.7 : 0.16
    const tone = ctx.createOscillator()
    tone.type = 'square'
    tone.frequency.value = go ? 1320 : 660
    const soften = ctx.createBiquadFilter()
    soften.type = 'lowpass'
    soften.frequency.value = 2600
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.22, t + 0.008)
    gain.gain.setValueAtTime(0.22, t + length - 0.05)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
    tone.connect(soften).connect(gain).connect(this.master)
    tone.start(t)
    tone.stop(t + length + 0.02)
  }

  /** Menu soundtrack selection and on/off; safe before unlock, applied when the graph exists. */
  setMenuMusic(trackId: string, enabled: boolean): void {
    this.musicTrackId = musicTrack(trackId).id
    this.musicEnabled = enabled
    if (!this.music) return
    // Pause before swapping while muted so a track change can never blip.
    if (!enabled) this.music.setEnabled(false)
    this.music.setTrack(musicTrack(this.musicTrackId))
    this.music.setEnabled(enabled)
    this.music.setActive(this.scene === 'menu')
  }

  /** Menu/garage vs. on track: sets the room tone and whether the engine is heard. */
  setScene(scene: 'menu' | 'race'): void {
    this.scene = scene
    this.music?.setActive(scene === 'menu')
    this.applyMix()
  }

  /** In the menu, let the engine be heard (a car swap revs out and rolls in). */
  setMenuEngine(on: boolean): void {
    if (on === this.menuEngine) return
    this.menuEngine = on
    this.applyMix()
  }

  setFinishMix(active: boolean): void {
    if (this.finishMix === active) return
    this.finishMix = active
    this.applyMix()
  }

  private applyMix(): void {
    const ctx = this.ctx
    if (!ctx || !this.carBus) return
    const engine = this.scene === 'race' || this.menuEngine ? (this.finishMix ? .55 : 1) : 0
    this.carBus.gain.setTargetAtTime(engine, ctx.currentTime, 0.12)
    this.ambience?.setLevel(this.scene === 'menu' ? 1 : 0)
  }

  setVolume(volume: number): void {
    this.volume = volume
    this.applyNarrationMix()
  }

  private applyNarrationMix(): void {
    const ducked = narrationMix.getState().voices > 0
    const level = this.volume * (ducked ? NARRATION_GAME_LEVEL : 1)
    Howler.volume(level)
    if (!this.master || !this.ctx) return
    const target = level * .9
    if (target === this.mixTarget) return
    const gain = this.master.gain
    const now = this.ctx.currentTime
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.setTargetAtTime(target, now, ducked ? .035 : .2)
    this.mixTarget = target
  }

  update(state: CarSoundState, tyres?: TyreBrakeInput): void {
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
    if (tyres) this.tyres?.update(tyreBrakeLevels(tyres, this.noiseProfile), dt)
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

  updateDriving(speed: number, paved: number, grounded: number, roughness: number, cockpit: boolean, active: boolean): void {
    this.driving?.update(speed, paved, grounded, roughness, cockpit, active && !this.paused)
  }

  /** Camera position/orientation, never the player's heading during cinematics. */
  updateTrackside(areas: readonly TracksideEmitter[] | undefined, camera: Camera, active: boolean, volume: number): void {
    if (!this.ctx) return
    if (areas !== this.tracksideAreas) {
      this.tracksideAreas = areas
      if (areas?.length) {
        this.trackside ??= new TracksideAmbience(this.ctx, this.master)
        this.trackside.setAreas(areas)
      } else { this.trackside?.dispose(); this.trackside = null }
    }
    if (!this.trackside) return
    camera.updateWorldMatrix(true, false)
    const e = camera.matrixWorld.elements
    this.trackside.update(e[12], e[13], e[14], e[0], e[1], e[2], active && !this.paused && this.scene === 'race', volume)
  }

  suspend(): void {
    this.clearSpotter()
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
    this.rivalNoise = []
  }

  setOpponentCars(cars: readonly { audioUrl?: string; firingPerRev: number; noise?: CarNoiseProfile }[]): void {
    this.clearOpponents()
    const ctx = this.ctx
    if (!ctx) return
    for (const car of cars) {
      const rival = new OpponentAudio(ctx, this.master, car.firingPerRev, car.noise ?? DEFAULT_NOISE_PROFILE)
      this.rivalNoise.push(car.noise ?? DEFAULT_NOISE_PROFILE)
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

  /** A rival's tyres and brakes go through the same model as the player's, with its own profile. */
  updateOpponent(index: number, state: Omit<RivalSoundState, 'tyres'>, tyres: TyreBrakeInput): void {
    const rival = this.rivals[index]
    if (!rival) return
    this.rivalState.tyres = tyreBrakeLevels(tyres, this.rivalNoise[index] ?? DEFAULT_NOISE_PROFILE)
    rival.update(Object.assign(this.rivalState, state))
  }

  /** A hit on a car: `car` -1 is the player, otherwise the rival's index (heard where it is). */
  impact(car: number, kind: ImpactKind, strength: number): void {
    if (this.paused || strength <= 0) return
    const played = (car < 0 ? this.impacts : this.rivals[car]?.impacts)?.hit(kind, strength)
    if (!played) return
    const ctx = this.ctx
    // Your own hit (not a curb thunk): the engine drops away, up to ~8 dB
    // on a big one, briefly holds the transient and then recovers, so the crash owns the moment.
    if (car < 0 && kind !== 'curb' && ctx && this.duck) {
      const t = ctx.currentTime
      const g = this.duck.gain
      g.cancelScheduledValues(t)
      g.setValueAtTime(g.value, t)
      g.linearRampToValueAtTime(1 - 0.6 * strength, t + 0.012)
      g.setTargetAtTime(1, t + 0.045 + 0.08 * strength, 0.13)
    }
  }

  /** Grinding along a wall, 0..1, for the player (-1) or a rival; follow every frame. */
  scrape(car: number, level: number, slidingSpeed: number): void {
    ;(car < 0 ? this.impacts : this.rivals[car]?.impacts)?.scrape(level, slidingSpeed)
  }

  dispose(): void {
    this.unsubscribeNarration()
    this.clearSpotter()
    this.clearOpponents()
    this.impacts?.dispose()
    this.driving?.dispose()
    this.trackside?.dispose(); this.trackside = null; this.tracksideAreas = undefined
    this.engineBank = null
    this.bankCache.clear()
    this.sound?.dispose()
    this.tyres?.dispose()
    this.ambience?.dispose()
    this.music?.dispose()
    this.music = null
    this.sampled?.disconnect()
    this.sampled?.port.close()
    this.master?.disconnect()
    this.limiter?.disconnect()
    this.duck?.disconnect()
    this.fxBus?.disconnect()
    if (this.ctx && this.ctx !== Howler.ctx) void this.ctx.close()
    this.ctx = null
  }
}
