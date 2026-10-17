import { Howler } from 'howler'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AudioManager } from '../src/audio/AudioManager'
import { decodeWav16, GranularEngine, type EngineBank } from '../src/audio/GranularEngine'

const OUT_RATE = 48000

/** Dominant period of `x` in samples, by autocorrelation within [minLag, maxLag]. */
function period(x: Float32Array, minLag: number, maxLag: number): number {
  let best = minLag
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i + lag < x.length; i++) s += x[i] * x[i + lag]
    if (s > bestScore) {
      bestScore = s
      best = lag
    }
  }
  return best
}

function render(engine: GranularEngine, rpm: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(OUT_RATE * seconds))
  const block = new Float32Array(128)
  for (let o = 0; o < out.length; o += 128) {
    engine.render(block, rpm)
    out.set(block.subarray(0, Math.min(128, out.length - o)), o)
  }
  return out
}

/** Firing frequency for a flat-six: rpm / 60 * 3. */
const firingPeriod = (rpm: number) => OUT_RATE / ((rpm / 60) * 3)

/** A synthetic "engine": decaying pulses at a fixed rate, with marks on each pulse. */
function pulseBank(rpm: number, sampleRate = 44100): { pcm: Float32Array; bank: EngineBank } {
  const p = sampleRate / ((rpm / 60) * 3)
  const n = Math.round(p * 60)
  const pcm = new Float32Array(n + 1)
  const marks: number[] = []
  for (let k = 0; k * p < n; k++) {
    const m = Math.round(k * p)
    marks.push(m)
    for (let i = 0; i < p && m + i < n; i++) pcm[m + i] = Math.exp(-i / (p / 6)) * Math.sin(i * 0.25)
  }
  return { pcm, bank: { sampleRate, firingPerRev: 3, layers: [{ name: 'test', rpm, start: 0, length: n, marks }] } }
}

describe('GranularEngine', () => {
  it('fires at the target rpm, not the recording rpm', () => {
    const { pcm, bank } = pulseBank(2000)
    for (const rpm of [1200, 2000, 4500, 7500]) {
      const engine = new GranularEngine(pcm, bank, OUT_RATE)
      const out = render(engine, rpm, 0.3)
      const want = firingPeriod(rpm)
      const got = period(out.subarray(2000), Math.floor(want * 0.7), Math.ceil(want * 1.4))
      expect(Math.abs(got - want) / want).toBeLessThan(0.03)
    }
  })

  it('keeps roughly the same loudness when pitched up and down', () => {
    const { pcm, bank } = pulseBank(2500)
    const rms = (rpm: number) => {
      const x = render(new GranularEngine(pcm, bank, OUT_RATE), rpm, 0.3).subarray(2000)
      let s = 0
      for (const v of x) s += v * v
      return Math.sqrt(s / x.length)
    }
    const ref = rms(2500)
    for (const rpm of [1800, 4000, 7000]) {
      const r = rms(rpm) / ref
      expect(r).toBeGreaterThan(0.6)
      expect(r).toBeLessThan(1.6)
    }
  })

  it('stays bounded and finite with a fixed grain pool at redline', () => {
    const { pcm, bank } = pulseBank(1200)
    const engine = new GranularEngine(pcm, bank, OUT_RATE)
    const out = render(engine, 8000, 1)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(Math.max(...out.map(Math.abs))).toBeLessThan(4)
    expect(engine.activeGrains).toBeLessThanOrEqual(48)
  })

  it('decodes 16-bit WAV without resampling', () => {
    const frames = [0, 16384, -16384, 32767]
    const buf = new ArrayBuffer(44 + frames.length * 2)
    const v = new DataView(buf)
    const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    str(0, 'RIFF'); v.setUint32(4, 36 + frames.length * 2, true); str(8, 'WAVE')
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, 22050, true); v.setUint32(28, 44100, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
    str(36, 'data'); v.setUint32(40, frames.length * 2, true)
    frames.forEach((f, i) => v.setInt16(44 + i * 2, f, true))
    const { pcm, sampleRate } = decodeWav16(buf)
    expect(sampleRate).toBe(22050)
    expect(Array.from(pcm.subarray(0, 4))).toEqual([0, 0.5, -0.5, 32767 / 32768])
  })
})

describe('AudioManager', () => {
  it("turns off Howler's 30 s auto-suspend, which silenced the borrowed context mid-race", () => {
    Howler.autoSuspend = true
    new AudioManager()
    expect(Howler.autoSuspend).toBe(false)
  })
})

// The shipped engine banks (Git LFS). Skipped when only the LFS pointer is checked out.
for (const [car, redline] of [
  ['porsche911', 7500],
  ['koenigsegg', 8250],
] as const) {
  const dir = `public/audio/${car}`
  const wavPath = `${dir}/engine-bank.wav`
  const hasBank = existsSync(wavPath) && readFileSync(wavPath).subarray(0, 4).toString() === 'RIFF'

  describe.skipIf(!hasBank)(`${car} engine bank`, () => {
    const bank = JSON.parse(readFileSync(`${dir}/engine-bank.json`, 'utf8')) as EngineBank
    const file = readFileSync(wavPath)
    const { pcm, sampleRate } = decodeWav16(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength))

    it('manifest matches the audio', () => {
      expect(sampleRate).toBe(bank.sampleRate)
      for (const l of bank.layers) {
        expect(l.start + l.length).toBeLessThanOrEqual(pcm.length)
        expect(l.marks.length).toBeGreaterThan(10)
        expect(l.marks.at(-1)!).toBeLessThan(l.length)
      }
    })

    it('plays the real recording at the requested rpm across the rev range', () => {
      for (const rpm of [900, 2500, 5000, redline]) {
        const out = render(new GranularEngine(pcm, bank, OUT_RATE), rpm, 0.4)
        const want = OUT_RATE / ((rpm / 60) * bank.firingPerRev)
        // Real engines have strong half orders: every other pulse can win.
        const ratio = period(out.subarray(4000), Math.floor(want * 0.3), Math.ceil(want * 2.2)) / want
        expect(Math.min(Math.abs(ratio - 1), Math.abs(ratio - 2))).toBeLessThan(0.05)
        expect(out.every(Number.isFinite)).toBe(true)
      }
    })
  })
}
