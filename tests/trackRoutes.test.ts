import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recordTrack } from '../src/racing/routeVersions'
import { collectBests } from '../src/cloud/leaderboardData'

type Manifest = { line: [number, number, number][]; lineLength: number; checkpoints: { position: [number, number, number] }[]; spawn: { position: [number, number, number] } }
const manifest = (id: string) => JSON.parse(readFileSync(`public/models/tracks/${id}/track.json`, 'utf8')) as Manifest

describe('race routes', () => {
  it.each(['u2city', 'paris', 'nurburgring', 'singapore', 'canyon', 'drift-park'])('%s: the line stays on one road level and its gates come in order', (id) => {
    const { line, checkpoints } = manifest(id)
    for (let i = 0; i < line.length; i++) {
      const a = line[i], b = line[(i + 1) % line.length]
      expect(Math.abs(b[1] - a[1]), `height step at line point ${i}`).toBeLessThanOrEqual(1.5)
    }
    const at = checkpoints.map((g) => line.findIndex((p) => Math.hypot(p[0] - g.position[0], p[2] - g.position[2]) < 2))
    expect(at[0]).toBeLessThanOrEqual(1)
    for (let i = 1; i < at.length; i++) expect(at[i], `gate ${i}`).toBeGreaterThan(at[i - 1])
  })

  it('Bayview is a ~3 km figure of eight, starting at gate 0', () => {
    const m = manifest('u2city')
    expect(m.lineLength).toBeGreaterThan(2900)
    expect(m.checkpoints.length).toBe(12)
    expect(Math.hypot(m.spawn.position[0] - m.checkpoints[0].position[0], m.spawn.position[2] - m.checkpoints[0].position[2])).toBeLessThan(25)
  })

  it('records and leaderboards for the rerouted Bayview go under their own key', () => {
    expect(recordTrack('u2city')).toBe('u2city-v2')
    expect(recordTrack('paris')).toBe('paris')
    const [entry] = collectBests({ 'racing-game:trial:u2city-v2:bmw:e0-tstreet-sstock-w0-b0:v1': JSON.stringify({ lapMs: 80000 }) })
    expect(entry).toMatchObject({ kind: 'trial', track: 'u2city-v2', car: 'bmw', score: 80000 })
  })
})
