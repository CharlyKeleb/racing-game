import { describe, expect, it } from 'vitest'
import { mergeSnapshots, parseSnapshot, readSnapshot, replaceSnapshot, sameSnapshot, writeSnapshot, type SaveSnapshot } from '../src/cloud/saveData'

class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() { return this.map.size }
  clear() { this.map.clear() }
  getItem(k: string) { return this.map.get(k) ?? null }
  key(i: number) { return [...this.map.keys()][i] ?? null }
  removeItem(k: string) { this.map.delete(k) }
  setItem(k: string, v: string) { this.map.set(k, String(v)) }
}

const snap = (entries: Record<string, unknown>): SaveSnapshot => ({
  version: 1,
  entries: Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, JSON.stringify(v)])),
})
const value = (s: SaveSnapshot, key: string) => JSON.parse(s.entries[key])

describe('cloud save snapshot', () => {
  it('reads only synced keys and leaves device settings out', () => {
    const storage = new MemoryStorage()
    storage.setItem('racing-game:settings', JSON.stringify({ car: 'porsche911', quality: 'high', renderer: 'webgpu', laps: 3 }))
    storage.setItem('racing-game:trial:nurburgring:porsche911:e0-t0-s0-w0-b0:v1', JSON.stringify({ lapMs: 90000, splits: [] }))
    storage.setItem('racing-game:webgpu-lost', '1')
    storage.setItem('sb-abc-auth-token', 'secret')
    const s = readSnapshot(storage)
    expect(Object.keys(s.entries).sort()).toEqual(['racing-game:settings', 'racing-game:trial:nurburgring:porsche911:e0-t0-s0-w0-b0:v1'])
    expect(value(s, 'racing-game:settings')).toEqual({ car: 'porsche911', laps: 3 })
  })

  it('keeps this device\'s graphics settings when writing a cloud save back', () => {
    const storage = new MemoryStorage()
    storage.setItem('racing-game:settings', JSON.stringify({ car: 'porsche911', quality: 'low', postfx: false }))
    writeSnapshot(storage, snap({ 'racing-game:settings': { car: 'mclaren', laps: 5 } }))
    expect(JSON.parse(storage.getItem('racing-game:settings')!)).toEqual({ car: 'mclaren', laps: 5, quality: 'low', postfx: false })
  })

  it('merges: cloud settings win, builds combine per car, records keep the best', () => {
    const trial = 'racing-game:trial:city:porsche911:e1-t0-s0-w0-b0:v1'
    const drift = 'racing-game:drift:drift-park:flow:course-v1'
    const local = snap({
      'racing-game:settings': { laps: 1 },
      'racing-game:builds': { porsche911: { engine: 1 }, mclaren: { engine: 2 } },
      [trial]: { lapMs: 80000, splits: [] },
      [drift]: { score: 1000, chain: 3 },
      'racing-game:trial:canyon:porsche911:x:v1': { lapMs: 120000, splits: [] },
    })
    const cloud = snap({
      'racing-game:settings': { laps: 5 },
      'racing-game:builds': { porsche911: { engine: 3 } },
      [trial]: { lapMs: 85000, splits: [] },
      [drift]: { score: 4000, chain: 1 },
    })
    const merged = mergeSnapshots(local, cloud)
    expect(value(merged, 'racing-game:settings')).toEqual({ laps: 5 })
    expect(value(merged, 'racing-game:builds')).toEqual({ porsche911: { engine: 3 }, mclaren: { engine: 2 } })
    expect(value(merged, trial).lapMs).toBe(80000)
    expect(value(merged, drift).score).toBe(4000)
    expect(value(merged, 'racing-game:trial:canyon:porsche911:x:v1').lapMs).toBe(120000)
  })

  it('merges presets by id, cloud first', () => {
    const local = snap({ 'racing-game:presets': { porsche911: [{ id: 'a', name: 'Local A' }, { id: 'b', name: 'B' }] } })
    const cloud = snap({ 'racing-game:presets': { porsche911: [{ id: 'a', name: 'Cloud A' }] } })
    expect(value(mergeSnapshots(local, cloud), 'racing-game:presets').porsche911.map((p: { name: string }) => p.name)).toEqual(['Cloud A', 'B'])
  })

  it('first sign-in with no cloud save uploads the local progress as is', () => {
    const local = snap({ 'racing-game:settings': { laps: 3 } })
    expect(mergeSnapshots(local, null)).toBe(local)
  })

  it('a different player replaces synced keys instead of inheriting them', () => {
    const storage = new MemoryStorage()
    storage.setItem('racing-game:trial:a:b:c:v1', JSON.stringify({ lapMs: 1 }))
    storage.setItem('racing-game:webgpu-lost', '1')
    replaceSnapshot(storage, snap({ 'racing-game:builds': {} }))
    expect(storage.getItem('racing-game:trial:a:b:c:v1')).toBeNull()
    expect(storage.getItem('racing-game:webgpu-lost')).toBe('1')
    expect(storage.getItem('racing-game:builds')).toBe('{}')
  })

  it('rejects rows it does not understand and drops unknown keys', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({ version: 2, entries: {} })).toBeNull()
    expect(parseSnapshot({ version: 1, entries: { 'racing-game:builds': '{}', evil: 'x', 'racing-game:presets': 5 } }))
      .toEqual({ version: 1, entries: { 'racing-game:builds': '{}' } })
  })

  it('compares snapshots by content', () => {
    expect(sameSnapshot(snap({ a: 1 }), snap({ a: 1 }))).toBe(true)
    expect(sameSnapshot(snap({ a: 1 }), snap({ a: 2 }))).toBe(false)
    expect(sameSnapshot(snap({ a: 1 }), snap({ a: 1, b: 1 }))).toBe(false)
  })
})
