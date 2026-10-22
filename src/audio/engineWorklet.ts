/**
 * AudioWorklet that runs GranularEngine on the audio thread. AudioManager
 * loads it with `?worker&url`, posts the decoded grain bank once, then drives
 * the `rpm` and `level` params.
 */
import { GranularEngine, type EngineBank } from './GranularEngine'

// AudioWorkletGlobalScope isn't in the DOM lib; declare just what we use.
declare const sampleRate: number
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void

export interface EngineBankMessage {
  pcm: Float32Array
  bank: EngineBank
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 900, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'level', defaultValue: 1, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ]
  }

  private engine: GranularEngine | null = null

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<EngineBankMessage>) => {
      this.engine = new GranularEngine(e.data.pcm, e.data.bank, sampleRate)
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], params: Record<string, Float32Array>): boolean {
    const out = outputs[0]?.[0]
    if (out && this.engine) this.engine.render(out, params.rpm[0], params.level[0])
    return true
  }
}

registerProcessor('granular-engine', EngineProcessor)
