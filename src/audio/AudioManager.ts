import { Howler } from 'howler'

/**
 * Engine + tire audio. Ships with a procedural Web Audio engine so the car is
 * never silent; swap in recorded loops (Howler sprites, rpm-crossfaded layers)
 * under public/audio/ once we have them. Howler owns the global volume/unlock
 * so one-shot SFX added later share the same mixer.
 */
export class AudioManager {
  private ctx: AudioContext | null = null
  private master!: GainNode
  private engineOsc!: OscillatorNode
  private engineSub!: OscillatorNode
  private engineFilter!: BiquadFilterNode
  private engineGain!: GainNode
  private squealGain!: GainNode
  private squealFilter!: BiquadFilterNode

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
  }

  setVolume(volume: number): void {
    Howler.volume(volume)
    if (this.master) this.master.gain.value = volume * 0.5
  }

  /** @param rpm engine rpm, @param throttle 0..1, @param slip max tire slip 0..1 */
  update(rpm: number, throttle: number, slip: number): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    // V8 firing frequency ≈ rpm/60 * cylinders/2
    const fire = (rpm / 60) * 4
    this.engineOsc.frequency.setTargetAtTime(fire, t, 0.03)
    this.engineSub.frequency.setTargetAtTime(fire / 2, t, 0.03)
    this.engineFilter.frequency.setTargetAtTime(400 + throttle * 2200 + rpm * 0.15, t, 0.05)
    this.engineGain.gain.setTargetAtTime(0.18 + throttle * 0.22, t, 0.05)
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
    this.master?.disconnect()
    if (this.ctx && this.ctx !== Howler.ctx) void this.ctx.close()
    this.ctx = null
  }
}
