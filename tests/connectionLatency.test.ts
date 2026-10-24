import { expect, it } from 'vitest'
import { ConnectionLatency } from '../src/multiplayer/ConnectionLatency'
it('measures with one clock, bounds samples at eight and rejects duplicate or unrelated echoes', () => {
  const probe = new ConnectionLatency()
  expect(probe.read(0)).toBeNull()
  let now = 0
  for (let i = 0; i < 12; i++) {
    const sequence = probe.next(now)
    expect(sequence).toBe(i)
    expect(probe.next(now + 1)).toBeNull()
    expect(probe.accept({ sequence }, now + 10)).toBe(false)
    expect(probe.accept(sequence! + 1, now + 10)).toBe(false)
    expect(probe.accept(sequence, now + 10 + i)).toBe(true)
    expect(probe.accept(sequence, now + 10 + i)).toBe(false)
    now += 2000
  }
  expect(probe.read(now)).toEqual({ rttMs: 21, variationMs: 7, samples: 8 })
})
it('expires missing echoes and old samples without accumulating a send queue', () => {
  const probe = new ConnectionLatency(), first = probe.next(0)
  expect(probe.accept(first, 100)).toBe(true)
  const missing = probe.next(2000)
  expect(probe.next(4000)).toBeNull()
  expect(probe.read(5100)).toBeNull()
  const fresh = probe.next(7000)
  expect(fresh).not.toBe(missing)
  expect(probe.accept(missing, 7010)).toBe(false)
  expect(probe.accept(fresh, 7100)).toBe(true)
  expect(probe.read(7100)).toEqual({ rttMs: 100, variationMs: 0, samples: 1 })
})
it('rejects clock discontinuity, nonfinite elapsed time and delayed echoes', () => {
  for (const end of [-1, Infinity, NaN, 5000, 60000]) {
    const probe = new ConnectionLatency(), sequence = probe.next(0)
    expect(probe.accept(sequence, end)).toBe(false)
    expect(probe.read(1)).toBeNull()
  }
  const probe = new ConnectionLatency(), sequence = probe.next(100)
  probe.accept(sequence, 200)
  expect(probe.read(150)).toBeNull()
})
