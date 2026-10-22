import type { TracksideEmitter } from '../world/atmospherePlan'
import { tracksideGain } from '../world/atmospherePlan'
import { makeTracksidePCM } from './TracksidePCM'

interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
  panner: StereoPannerNode
  filter: BiquadFilterNode
  emitter: TracksideEmitter
}

/** Three quiet fixed sources, panned from the active camera and routed through master. */
export class TracksideAmbience {
  private readonly wind: AudioBuffer
  private readonly pit: AudioBuffer
  private readonly voices: Voice[] = []
  private readonly ctx: AudioContext
  private readonly destination: AudioNode

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx; this.destination = destination
    const buffer = (pit: boolean) => {
      const pcm = makeTracksidePCM(pit), b = ctx.createBuffer(1, pcm.length, 22050)
      b.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0)
      return b
    }
    this.wind = buffer(false); this.pit = buffer(true)
  }

  setAreas(areas: readonly TracksideEmitter[]): void {
    this.clear()
    for (let i = 0; i < Math.min(areas.length, 4); i++) {
      const source = this.ctx.createBufferSource(), gain = this.ctx.createGain(), panner = this.ctx.createStereoPanner()
      const filter = this.ctx.createBiquadFilter()
      source.buffer = areas[i].pit ? this.pit : this.wind; source.loop = true
      gain.gain.value = 0
      filter.type = 'lowpass'; filter.frequency.value = 2400
      source.connect(gain).connect(filter).connect(panner).connect(this.destination)
      source.start(0, i * 1.71 % source.buffer.duration)
      this.voices.push({ source, gain, panner, filter, emitter: areas[i] })
    }
  }

  update(x: number, y: number, z: number, rightX: number, rightY: number, rightZ: number, active: boolean, volume: number): void {
    const t = this.ctx.currentTime
    for (const voice of this.voices) {
      const e = voice.emitter, dx = e.x - x, dy = e.y + 1.5 - y, dz = e.z - z
      const d = Math.hypot(dx, dy, dz)
      voice.gain.gain.setTargetAtTime(active ? tracksideGain(d) * Math.max(0, Math.min(1, volume)) * .65 : 0, t, .12)
      voice.panner.pan.setTargetAtTime(Math.max(-.85, Math.min(.85, (dx * rightX + dy * rightY + dz * rightZ) / Math.max(8, d))), t, .1)
      voice.filter.frequency.setTargetAtTime(900 + 2100 / (1 + d / 35), t, .15)
    }
  }

  private clear(): void {
    for (const v of this.voices) {
      v.source.stop(); v.source.disconnect(); v.gain.disconnect(); v.panner.disconnect(); v.filter.disconnect()
    }
    this.voices.length = 0
  }

  dispose(): void { this.clear() }
}
