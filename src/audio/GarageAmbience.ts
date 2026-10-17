/**
 * Room tone for the garage (main menu and garage screens), generated rather
 * than recorded: a low HVAC rumble (brown noise, low-passed), a faint mains hum
 * from the strip lights, and slow swells so it breathes instead of droning.
 * Sits well under the engine; `setLevel` fades it between scenes.
 */

/** Overall level at full volume: room tone should be felt more than heard. */
const LEVEL = 0.22

export class GarageAmbience {
  private readonly ctx: BaseAudioContext
  private readonly out: GainNode
  private readonly sources: AudioScheduledSourceNode[] = []

  constructor(ctx: BaseAudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.out.connect(destination)

    // HVAC rumble: brown noise (integrated white noise), low-passed.
    const seconds = 4
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < data.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02
      data[i] = last * 3.5
    }
    // Crossfade the loop seam so it doesn't click every four seconds.
    const fade = Math.floor(ctx.sampleRate * 0.25)
    for (let i = 0; i < fade; i++) {
      const t = i / fade
      data[i] = data[i] * t + data[data.length - fade + i] * (1 - t)
    }
    const rumble = ctx.createBufferSource()
    rumble.buffer = buffer
    rumble.loop = true
    rumble.loopEnd = seconds - 0.25
    const low = ctx.createBiquadFilter()
    low.type = 'lowpass'
    low.frequency.value = 260
    const air = ctx.createGain()
    air.gain.value = 0.8
    rumble.connect(low).connect(air).connect(this.out)

    // Slow swells on the rumble: a 0.07 Hz LFO, ±25%.
    const lfo = ctx.createOscillator()
    lfo.frequency.value = 0.07
    const depth = ctx.createGain()
    depth.gain.value = 0.2
    lfo.connect(depth).connect(air.gain)

    // Strip-light hum: 100 Hz with a little second harmonic, barely there.
    for (const [freq, level] of [
      [100, 0.035],
      [200, 0.012],
    ]) {
      const osc = ctx.createOscillator()
      osc.frequency.value = freq
      const g = ctx.createGain()
      g.gain.value = level
      osc.connect(g).connect(this.out)
      osc.start()
      this.sources.push(osc)
    }

    rumble.start()
    lfo.start()
    this.sources.push(rumble, lfo)
  }

  /** 0 = silent, 1 = full room tone; fades over about a second. */
  setLevel(level: number): void {
    this.out.gain.setTargetAtTime(level * LEVEL, this.ctx.currentTime, 0.35)
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop()
      } catch {
        // already stopped
      }
    }
    this.out.disconnect()
  }
}
