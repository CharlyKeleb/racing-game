import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeThumpPCM } from '../src/audio/ImpactPCM'
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
interface FakeNode { kind: string; next?: FakeNode; gain?: { value: number }; type?: string; connect(n: FakeNode): FakeNode; disconnect(): void }
const node = (kind: string): FakeNode => ({ kind, connect(n) { this.next = n; return n }, disconnect: vi.fn() })
/** Each started one-shot: its buffer, the gain it plays at, and the filter types it passes through. */
type Started = { buffer: unknown; gain: number; filters: string[] }
function fakeContext(started: Started[] = []) {
  return {
    currentTime: 10,
    sampleRate: 44100,
    createBuffer: (c: number, n: number, rate: number) => new FakeBuffer(c, n, rate),
    createGain: () => ({ ...node('gain'), gain: param() }),
    createBiquadFilter: () => ({ ...node('filter'), type: '', Q: param(), frequency: param(), gain: param() }),
    createWaveShaper: () => ({ ...node('shaper'), curve: null }),
    createBufferSource() {
      const source = { ...node('source'), buffer: null as unknown, loop: false, playbackRate: param(), onended: null, stop: vi.fn(),
        start() {
          if (source.loop) return
          const filters: string[] = []
          let n = source.next
          while (n && n.kind !== 'gain') { if (n.kind === 'filter') filters.push(n.type ?? ''); n = n.next }
          started.push({ buffer: source.buffer, gain: n!.gain!.value, filters })
        } }
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

  it('plays a recording with a sub thump once loaded, louder for a harder hit; procedural before that', async () => {
    const started: Started[] = []
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
    expect(started).toHaveLength(1)
    ctx.currentTime += 1
    sound.hit('wall', 0.9)
    // Two voices: the recording through a low shelf, and the heavy-tier thump under it.
    const [heavy, thump] = started.slice(1)
    const heavyLengths = index.kinds.wall![2].map((v) => v.length)
    expect(heavyLengths).toContain((heavy.buffer as FakeBuffer).length)
    expect((heavy.buffer as FakeBuffer).length).not.toBe(proceduralLength)
    expect(heavy.filters).toEqual(['lowshelf'])
    expect((thump.buffer as FakeBuffer).length).toBe(makeThumpPCM(2, 44100).length)
    ctx.currentTime += 1
    sound.hit('wall', 0.8)
    expect(started[3].gain).toBeLessThan(heavy.gain)
    // Kerbs and landings have no recordings: still procedural, one voice.
    ctx.currentTime += 1
    const before = started.length
    sound.hit('curb', 0.5)
    expect(started.length).toBe(before + 1)
    expect(index.kinds.wall!.flat().map((v) => v.length)).not.toContain((started[before].buffer as FakeBuffer).length)
  })

  it('falls back quietly when the bank is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })))
    expect(await loadImpactRecordings(fakeContext() as unknown as BaseAudioContext)).toBe(false)
  })
})

describe('impact sub thump', () => {
  const band = (pcm: Float32Array, rate: number, hz: number) => {
    // Goertzel power at one frequency over the first 150 ms.
    const n = Math.round(rate * 0.15), k = 2 * Math.cos(2 * Math.PI * hz / rate)
    let a = 0, b = 0
    for (let i = 0; i < n; i++) { const c = pcm[i] + k * a - b; b = a; a = c }
    return a * a + b * b - k * a * b
  }
  it('is bass: far more energy at 60-100 Hz than at 1 kHz, and heavier tiers are louder and longer', () => {
    const rate = 48000
    const tiers = ([0, 1, 2] as const).map((t) => makeThumpPCM(t, rate))
    for (const pcm of tiers) expect(band(pcm, rate, 80)).toBeGreaterThan(band(pcm, rate, 1000) * 100)
    const rms = (pcm: Float32Array) => Math.sqrt(pcm.slice(0, rate * 0.15).reduce((s, v) => s + v * v, 0) / (rate * 0.15))
    expect(rms(tiers[1])).toBeGreaterThan(rms(tiers[0]))
    expect(rms(tiers[2])).toBeGreaterThan(rms(tiers[1]))
    expect(tiers[2].length).toBeGreaterThan(tiers[0].length)
  })
  it('starts and ends without a click and never clips', () => {
    for (const tier of [0, 1, 2] as const) {
      const pcm = makeThumpPCM(tier, 44100)
      expect(Math.abs(pcm[0])).toBeLessThan(0.01)
      expect(Math.abs(pcm[pcm.length - 1])).toBeLessThan(0.001)
      expect(Math.max(...pcm.map(Math.abs))).toBeLessThan(1)
    }
  })
})
