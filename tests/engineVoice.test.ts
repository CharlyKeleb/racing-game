import { describe, expect, it } from 'vitest'
import { selectableCars } from '../src/vehicles/carRegistry'

/**
 * Only some cars ship their own engine recordings; the rest re-voice one.
 * Every car in the garage must still sound like itself: different engine
 * character and different exhaust pops from every other car.
 */
describe('engine voices', () => {
  const cars = selectableCars()

  it('no two cars share an engine sound', () => {
    for (const [i, a] of cars.entries()) {
      for (const b of cars.slice(i + 1)) {
        if (a.audioUrl !== b.audioUrl) continue
        const va = a.voice, vb = b.voice
        // Same recording: it must be pitched, voiced or characterised apart.
        const pitch = Math.abs(Math.log(va.pitch / vb.pitch)) > 0.05
        const exhaust = Math.abs(Math.log(va.boomHz / vb.boomHz)) > 0.15 || Math.abs(Math.log(va.raspHz / vb.raspHz)) > 0.15
        const character = Math.abs(va.burble - vb.burble) > 0.2 || Math.abs(va.turbo - vb.turbo) > 0.5 || va.whine.ratio !== vb.whine.ratio
        expect([pitch, exhaust, character].filter(Boolean).length, `${a.id} vs ${b.id}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('no two cars share their exhaust pops', () => {
    for (const [i, a] of cars.entries()) {
      for (const b of cars.slice(i + 1)) {
        const pa = a.voice.pops, pb = b.voice.pops
        const pitch = Math.abs(Math.log(pa.pitch / pb.pitch)) > 0.04
        const tone = Math.abs(Math.log(pa.toneHz / pb.toneHz)) > 0.1
        const weight = Math.abs(pa.bang - pb.bang) > 0.1 || Math.abs(pa.thump - pb.thump) > 0.1 || Math.abs(pa.crackle - pb.crackle) > 0.1
        expect(pitch || tone || weight, `${a.id} vs ${b.id}`).toBe(true)
      }
    }
  })

  it('keeps the recorded engine inside the worklet range at redline', async () => {
    const { readFile } = await import('node:fs/promises')
    for (const car of cars) {
      const config = JSON.parse(await readFile(`public${car.configUrl}`, 'utf8'))
      expect(config.engine.redlineRpm * car.voice.pitch, car.id).toBeLessThan(20000)
    }
  })
})
