import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { RACE_MUSIC_TRACKS, RacePlaylist } from '../src/audio/musicTracks'

describe('race playlist', () => {
  it('plays every track once before any repeats, and never the same one twice in a row', () => {
    let seed = 7
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const playlist = new RacePlaylist(5, random)
    const plays = Array.from({ length: 50 }, () => playlist.next())
    for (let round = 0; round < 10; round++) expect(new Set(plays.slice(round * 5, round * 5 + 5)).size).toBe(5)
    for (let i = 1; i < plays.length; i++) expect(plays[i]).not.toBe(plays[i - 1])
  })
  it('handles one track and an empty list', () => {
    expect([1, 2, 3].map(() => new RacePlaylist(1).next())).toEqual([0, 0, 0])
    expect(new RacePlaylist(0).next()).toBe(-1)
  })
  it('ships every track with a credited source and a licence that allows it', () => {
    const credits = readFileSync('public/audio/music/race/CREDITS.md', 'utf8')
    for (const track of RACE_MUSIC_TRACKS) {
      expect(['CC0 1.0', 'CC BY 4.0']).toContain(track.license)
      expect(track.source).toMatch(/^https:\/\/opengameart\.org\/content\//)
      expect(existsSync(`public${track.file}`)).toBe(true)
      const file = track.file.split('/').pop()!
      expect(credits).toContain(`\`${file}\``)
      expect(credits).toContain(track.source)
    }
  })
})
