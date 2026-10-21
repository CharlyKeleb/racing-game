import type { EngineBankMessage } from './engineWorklet'
import { TyreBrakeSound } from './TyreBrakeSound'
import { ImpactSound } from './ImpactSound'
import { BackfireSound } from './BackfireSound'
import type { CarNoiseProfile, TyreBrakeLevels } from './TyreBrakeModel'

/** Speed of sound, m/s, for the doppler shift. */
const SOUND_SPEED = 343
/** Inverse-distance falloff: full level within this many metres… */
const REF_DISTANCE = 7
/** …then 1 / (1 + ROLLOFF·(d − ref)/ref): a rival is plainly there at 60 m, a murmur at 200 m. */
const ROLLOFF = 0.9
/**
 * Engine level at full throttle within REF_DISTANCE, before falloff. The
 * player's engine runs through CarSound's exhaust layers and make-up gain; a
 * rival's raw recording needs ~+11 dB to sit level with it alongside (it was
 * 13 dB under, so 30 m back it was gone).
 */
const ENGINE_LEVEL = 3

export interface RivalSoundState {
  /** Engine rpm and pedal, 0..1. */
  rpm: number
  throttle: number
  /** Rival relative to the listener (the camera), in the camera's frame: +x right, +y up, +z behind. */
  x: number
  y: number
  z: number
  /** Rate the distance is growing, m/s (negative while closing): the doppler shift. */
  recession: number
  /** Speed of the rival past the listener, m/s (wind rush when close). */
  passSpeed: number
  /** The rival's tyres and brakes (TyreBrakeModel). */
  tyres: TyreBrakeLevels
  active: boolean
}

/**
 * A rival car you can hear: its recorded engine (or a synth until the
 * recording loads), its tyres and brakes, and the wind it pushes past you,
 * all placed in 3D around the camera. Distance dulls it the way air does
 * (the highs go first) and the closing speed bends its pitch, so a car
 * coming up behind rises and drops away as it passes.
 */
export class OpponentAudio {
  private readonly ctx: AudioContext
  private readonly firing: number
  private readonly panner: PannerNode
  private readonly air: BiquadFilterNode
  private readonly engineGain: GainNode
  private readonly synth: OscillatorNode
  private readonly fallback: GainNode
  private sampled: AudioWorkletNode | null = null
  private readonly tyres: TyreBrakeSound
  private readonly tyreAir: BiquadFilterNode
  /** Its crashes and wall scrapes, placed where it is. */
  readonly impacts: ImpactSound
  /** Its exhaust pops, placed where it is. */
  readonly backfires: BackfireSound
  private readonly wind: AudioBufferSourceNode
  private readonly windGain: GainNode
  private doppler = 1
  private lastTime = 0

  constructor(ctx: AudioContext, destination: AudioNode, firing: number, noise: CarNoiseProfile) {
    this.ctx = ctx
    this.firing = firing
    this.panner = new PannerNode(ctx, {
      panningModel: 'equalpower',
      distanceModel: 'inverse',
      refDistance: REF_DISTANCE,
      rolloffFactor: ROLLOFF,
      maxDistance: 5000,
    })
    this.panner.connect(destination)

    // Engine: recording (or synth) → air absorption → level → 3D.
    this.air = ctx.createBiquadFilter()
    this.air.type = 'lowpass'
    this.air.frequency.value = 8000
    this.engineGain = ctx.createGain()
    this.engineGain.gain.value = 0
    this.air.connect(this.engineGain).connect(this.panner)
    this.fallback = ctx.createGain()
    this.fallback.gain.value = 0.12
    this.synth = ctx.createOscillator()
    this.synth.type = 'sawtooth'
    this.synth.connect(this.fallback).connect(this.air)
    this.synth.start()

    // Tyres and brakes, through their own (gentler) air filter.
    this.tyres = new TyreBrakeSound(ctx, noise)
    this.tyreAir = ctx.createBiquadFilter()
    this.tyreAir.type = 'lowpass'
    this.tyreAir.frequency.value = 12000
    this.tyres.output.connect(this.tyreAir).connect(this.panner)

    this.impacts = new ImpactSound(ctx, this.panner)
    this.backfires = new BackfireSound(ctx, this.panner)

    // Wind rush as it passes.
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    this.wind = ctx.createBufferSource()
    this.wind.buffer = buf
    this.wind.loop = true
    const windBand = ctx.createBiquadFilter()
    windBand.type = 'bandpass'
    windBand.frequency.value = 700
    windBand.Q.value = 0.6
    this.windGain = ctx.createGain()
    this.windGain.gain.value = 0
    this.wind.connect(windBand).connect(this.windGain).connect(this.panner)
    this.wind.start()
  }

  setBank(bank: EngineBankMessage): void {
    this.sampled?.disconnect()
    this.sampled?.port.close()
    this.sampled = new AudioWorkletNode(this.ctx, 'granular-engine', { numberOfInputs: 0, outputChannelCount: [1] })
    this.sampled.port.postMessage(bank)
    this.sampled.connect(this.air)
    this.fallback.gain.value = 0
  }

  update(s: RivalSoundState): void {
    const t = this.ctx.currentTime
    const dt = Math.min(Math.max(t - this.lastTime, 0), 0.1)
    this.lastTime = t
    const distance = Math.hypot(s.x, s.y, s.z)

    this.panner.positionX.setTargetAtTime(s.x, t, 0.03)
    this.panner.positionY.setTargetAtTime(s.y, t, 0.03)
    this.panner.positionZ.setTargetAtTime(s.z, t, 0.03)

    // Doppler: f' = f · c / (c + v), v = rate the distance grows. Smoothed so a
    // physics hitch doesn't warble it; clamped against a teleport (respawn).
    const target = Math.max(0.75, Math.min(1.3, SOUND_SPEED / (SOUND_SPEED + s.recession)))
    this.doppler += (target - this.doppler) * Math.min(1, dt * 8)

    const on = s.active ? 1 : 0
    // Air absorption: the far car is all low end.
    this.air.frequency.setTargetAtTime(1200 + 16000 * Math.exp(-distance / 45), t, 0.08)
    this.tyreAir.frequency.setTargetAtTime(2500 + 15000 * Math.exp(-distance / 60), t, 0.08)
    this.engineGain.gain.setTargetAtTime(on * ENGINE_LEVEL * (0.55 + 0.45 * s.throttle), t, 0.06)
    const rpm = s.rpm * this.doppler
    this.synth.frequency.setTargetAtTime(Math.max(25, (rpm / 60) * this.firing), t, 0.04)
    this.sampled?.parameters.get('rpm')?.setTargetAtTime(rpm, t, 0.04)

    this.tyres.update(s.active ? s.tyres : SILENT, dt, this.doppler)
    // Wind: a rush only when a fast car is right there (it falls off much
    // faster than the engine), so it marks the moment it goes by.
    const rush = on * Math.min(1, (s.passSpeed / 45) ** 2) / (1 + (distance / 5) ** 2)
    this.windGain.gain.setTargetAtTime(rush * 1.2, t, 0.05)
  }

  dispose(): void {
    this.synth.stop()
    this.wind.stop()
    this.synth.disconnect()
    this.fallback.disconnect()
    this.sampled?.disconnect()
    this.sampled?.port.close()
    this.tyres.dispose()
    this.impacts.dispose()
    this.backfires.dispose()
    this.wind.disconnect()
    this.air.disconnect()
    this.tyreAir.disconnect()
    this.engineGain.disconnect()
    this.windGain.disconnect()
    this.panner.disconnect()
  }
}

const SILENT: TyreBrakeLevels = { squeal: 0, squealPitch: 1, scrub: 0, brakeHiss: 0, grind: 0, grindRate: 0, brakeSqueal: 0, abs: 0, kerbRumble: 0, kerbRate: 0 }
