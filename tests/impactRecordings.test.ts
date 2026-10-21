import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadImpactRecordings, sliceImpactBank, ImpactSound, type ImpactBankIndex } from '../src/audio/ImpactSound'

const index = JSON.parse(readFileSync('public/audio/impacts/impact-bank.json', 'utf8')) as ImpactBankIndex
const wav = readFileSync('public/audio/impacts/impact-bank.wav')

/** Just enough of an AudioBuffer / AudioContext for slicing and one-shot playback. */
class FakeBuffer {
  readonly data: Float32Array
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) { this.data = new Float32Array(length) }
  getChannelData() { return this.data }
  copyToChannel(src: Float32Array) { this.data.set(src.subarray(0, this.length)) }
}
const param = () => ({ value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn() })
const node = () => ({ connect(next: unknown) { return next }, disconnect: vi.fn() })
function fakeContext(started: { buffer: unknown; gain: number }[] = []) {
  return {
    currentTime: 10,
    sampleRate: 44100,
    createBuffer: (c: number, n: number, rate: number) => new FakeBuffer(c, n, rate),
    createGain: () => ({ ...node(), gain: param() }),
    createBiquadFilter: () => ({ ...node(), type: '', Q: param(), frequency: param() }),
    createWaveShaper: () => ({ ...node(), curve: null }),
    createBufferSource() {
      const source = { ...node(), buffer: null as unknown, loop: false, playbackRate: param(), onended: null, stop: vi.fn(),
        connect(gain: { gain: { value: number } }) { source.gainNode = gain; return gain },
        gainNode: null as null | { gain: { value: number } },
        start() { if (!source.loop) started.push({ buffer: source.buffer, gain: source.gainNode!.gain.value }) } }
      return source
    },
    decodeAudioData: vi.fn(async () => {
      const samples = (wav.length - 44) / 2
      const buffer = new FakeBuffer(1, samples, index.rate)
      for (let i = 0; i < samples; i++) buffer.data[i] = wav.readInt16LE(44 + i * 2) / 32768
      return buffer
    }),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('recorded impact bank', () => {
  it('ships a real WAV with light, medium and heavy variants for car and wall hits', () => {
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(index.rate)
    const samples = (wav.length - 44) / 2
    for (const kind of ['car', 'wall'] as const) {
      const tiers = index.kinds[kind]!
      expect(tiers).toHaveLength(3)
      for (const variants of tiers) {
        expect(variants.length).toBeGreaterThan(0)
        for (const v of variants) {
          expect(v.start + v.length).toBeLessThanOrEqual(samples)
          // Starts on the hit, not on silence: the first 5 ms already carry signal.
          let peak = 0
          for (let i = 0; i < index.rate * 0.005; i++) peak = Math.max(peak, Math.abs(wav.readInt16LE(44 + (v.start + i) * 2)))
          expect(peak / 32768, `${kind} ${v.source}`).toBeGreaterThan(0.02)
        }
      }
    }
  })

  it('slices at the decoded rate when the browser resampled the bank', () => {
    const ctx = fakeContext() as unknown as BaseAudioContext
    const decoded = new FakeBuffer(1, 48000 * 10, 48000) as unknown as AudioBuffer
    const bank = sliceImpactBank(ctx, decoded, index)
    const first = index.kinds.wall![0][0]
    expect(bank.get('wall')![0][0].length).toBe(Math.round(first.length * 48000 / index.rate))
  })

  it('plays a recording once loaded, louder for a harder hit; procedural before that', async () => {
    const started: { buffer: unknown; gain: number }[] = []
    const ctx = fakeContext(started)
    const sound = new ImpactSound(ctx as unknown as BaseAudioContext, ctx.createGain() as unknown as AudioNode)
    sound.hit('wall', 0.9)
    expect(started[0].buffer).toBeInstanceOf(FakeBuffer)
    const proceduralLength = (started[0].buffer as FakeBuffer).length

    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => wav.buffer,
      json: async () => (url.endsWith('.json') ? index : null),
    })))
    expect(await loadImpactRecordings(ctx as unknown as BaseAudioContext)).toBe(true)
    ctx.currentTime += 1
    sound.hit('wall', 0.9)
    const heavy = started[1]
    const heavyLengths = index.kinds.wall![2].map((v) => v.length)
    expect(heavyLengths).toContain((heavy.buffer as FakeBuffer).length)
    expect((heavy.buffer as FakeBuffer).length).not.toBe(proceduralLength)
    ctx.currentTime += 1
    sound.hit('wall', 0.8)
    expect(started[2].gain).toBeLessThan(heavy.gain)
    // Kerbs and landings have no recordings: still procedural.
    ctx.currentTime += 1
    sound.hit('curb', 0.5)
    expect(index.kinds.wall!.flat().map((v) => v.length)).not.toContain((started[3].buffer as FakeBuffer).length)
  })

  it('falls back quietly when the bank is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    expect(await loadImpactRecordings(fakeContext() as unknown as BaseAudioContext)).toBe(false)
  })
})
