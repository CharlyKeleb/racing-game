import type { EngineBankMessage } from './engineWorklet'

/** Lightweight positional rival engine. Reuses the player's decoded recording. */
export class OpponentAudio {
  private readonly gain: GainNode
  private readonly pan: StereoPannerNode
  private readonly tone: BiquadFilterNode
  private readonly synth: OscillatorNode
  private readonly fallback: GainNode
  private sampled: AudioWorkletNode | null = null
  private readonly ctx: AudioContext
  private readonly firing: number
  constructor(ctx: AudioContext, destination: AudioNode, firing: number) {
    this.ctx = ctx; this.firing = firing
    this.gain = ctx.createGain(); this.gain.gain.value = 0
    this.pan = ctx.createStereoPanner()
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 1100
    this.fallback = ctx.createGain(); this.fallback.gain.value = 0.12
    this.synth = ctx.createOscillator(); this.synth.type = 'sawtooth'
    this.synth.connect(this.fallback); this.fallback.connect(this.tone)
    this.tone.connect(this.gain); this.gain.connect(this.pan); this.pan.connect(destination)
    this.synth.start()
  }
  setBank(bank: EngineBankMessage): void {
    this.sampled?.disconnect(); this.sampled?.port.close()
    this.sampled = new AudioWorkletNode(this.ctx, 'granular-engine', { numberOfInputs: 0, outputChannelCount: [1] })
    this.sampled.port.postMessage(bank)
    this.sampled.connect(this.tone)
    this.fallback.gain.value = 0
  }
  /** Distance is 3D metres from the camera; lateral is metres toward camera-left. */
  update(rpm: number, throttle: number, distance: number, lateral: number, active: boolean): void {
    const t = this.ctx.currentTime
    const level = active ? (0.12 + 0.08 * throttle) / (1 + (distance / 12) ** 2) : 0
    this.gain.gain.setTargetAtTime(level, t, 0.06)
    this.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, -lateral / Math.max(8, distance))), t, 0.06)
    this.tone.frequency.setTargetAtTime(Math.max(250, 2200 - distance * 15), t, 0.1)
    this.synth.frequency.setTargetAtTime(Math.max(25, rpm / 60 * this.firing), t, 0.04)
    if (this.sampled) {
      this.sampled.parameters.get('rpm')?.setTargetAtTime(rpm, t, 0.04)
    }
  }
  dispose(): void {
    this.synth.stop(); this.synth.disconnect(); this.fallback.disconnect()
    this.sampled?.disconnect(); this.sampled?.port.close()
    this.tone.disconnect(); this.gain.disconnect(); this.pan.disconnect()
  }
}
