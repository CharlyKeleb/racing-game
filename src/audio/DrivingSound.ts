/** Speed and suspension-driven sound bed, kept below engine and tyre cues. */
export class DrivingSound {
  private readonly ctx: BaseAudioContext
  private readonly wind: AudioBufferSourceNode
  private readonly road: AudioBufferSourceNode
  private readonly windGain: GainNode
  private readonly roadGain: GainNode
  private readonly windFilter: BiquadFilterNode
  private readonly roadFilter: BiquadFilterNode
  constructor(ctx: BaseAudioContext, out: AudioNode) {
    this.ctx = ctx
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 3.17), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    let slow = 0, medium = 0, seed = 8191
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5
      const n = (seed >>> 0) / 2147483648 - 1
      slow += .015 * (n - slow); medium += .12 * (n - medium)
      data[i] = slow * 1.8 + medium * .7 + n * .12
    }
    // Overlap the tail into the head; no silent notch at the loop seam.
    const seam = Math.ceil(ctx.sampleRate * .025)
    for (let i = 0; i < seam; i++) {
      const w = i / seam
      data[i] = (data[data.length - seam + i] * (1 - w) + data[i] * w) / Math.sqrt((1 - w) ** 2 + w ** 2)
    }
    this.wind = ctx.createBufferSource(); this.road = ctx.createBufferSource()
    this.wind.buffer = this.road.buffer = buffer
    this.wind.loop = this.road.loop = true
    this.wind.loopEnd = this.road.loopEnd = (data.length - seam) / ctx.sampleRate
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'lowpass'; this.windFilter.Q.value = .5
    this.roadFilter = ctx.createBiquadFilter(); this.roadFilter.type = 'lowpass'; this.roadFilter.Q.value = .65
    this.windGain = ctx.createGain(); this.roadGain = ctx.createGain()
    this.windGain.gain.value = this.roadGain.gain.value = 0
    this.wind.connect(this.windFilter).connect(this.windGain).connect(out)
    this.road.connect(this.roadFilter).connect(this.roadGain).connect(out)
    this.wind.start(); this.road.start(0, .87)
  }
  update(speed: number, paved: number, grounded: number, roughness: number, cockpit: boolean, active: boolean): void {
    const t = this.ctx.currentTime
    const v = Math.min(1, Math.max(0, speed) / 80)
    const rolling = Math.min(1, Math.max(0, (speed - 1) / 28))
    const wind = active ? v ** 1.7 * (cockpit ? .24 : .46) : 0
    const road = active ? rolling * grounded * (.16 + (1 - paved) * .17 + roughness * .12) * (cockpit ? .7 : 1) : 0
    this.windGain.gain.setTargetAtTime(wind, t, .18)
    this.roadGain.gain.setTargetAtTime(road, t, .045)
    this.windFilter.frequency.setTargetAtTime((cockpit ? 700 : 1600) + v * (cockpit ? 800 : 2400), t, .15)
    this.roadFilter.frequency.setTargetAtTime(220 + v * 600 + (1 - paved) * 350, t, .08)
    this.road.playbackRate.setTargetAtTime(.65 + v * .7, t, .1)
  }
  dispose(): void {
    this.wind.stop(); this.road.stop()
    this.wind.disconnect(); this.road.disconnect()
    this.windFilter.disconnect(); this.roadFilter.disconnect()
    this.windGain.disconnect(); this.roadGain.disconnect()
  }
}
