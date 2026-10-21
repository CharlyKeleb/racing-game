/**
 * Menu soundtrack catalogue. Every track is CC0 (public domain), so the game
 * can ship it without attribution obligations; the credits file still lists
 * the source and author. Files live in public/audio/music/.
 */
export interface MusicTrack {
  id: string
  title: string
  artist: string
  /** Public URL, served from public/. */
  file: string
  source: string
  license: string
}

export const MUSIC_TRACKS = [
  {
    id: 'racing-game-menu',
    title: 'Racing Game Menu',
    artist: 'MintoDog',
    file: '/audio/music/racing-game-menu.mp3',
    source: 'https://opengameart.org/content/racing-game-menu',
    license: 'CC0 1.0',
  },
  {
    id: 'midnight-cruiser',
    title: 'Midnight Cruiser',
    artist: 'Zane Little Music',
    file: '/audio/music/midnight-cruiser.mp3',
    source: 'https://opengameart.org/content/midnight-cruiser',
    license: 'CC0 1.0',
  },
  {
    id: 'racing-game-title',
    title: 'Racing Game Title',
    artist: 'MintoDog',
    file: '/audio/music/racing-game-title.mp3',
    source: 'https://opengameart.org/content/racing-game-title',
    license: 'CC0 1.0',
  },
] as const satisfies readonly MusicTrack[]

export type MusicTrackId = (typeof MUSIC_TRACKS)[number]['id']

export function isMusicTrack(value: unknown): value is MusicTrackId {
  return typeof value === 'string' && MUSIC_TRACKS.some((track) => track.id === value)
}

export function musicTrack(id: string): MusicTrack {
  return MUSIC_TRACKS.find((track) => track.id === id) ?? MUSIC_TRACKS[0]
}

/** Wrap around the catalogue, so the menu's chevrons never dead-end. */
export function stepMusicTrack(id: string, step: 1 | -1): (typeof MUSIC_TRACKS)[number] {
  const index = MUSIC_TRACKS.findIndex((track) => track.id === id)
  const next = (index + step + MUSIC_TRACKS.length) % MUSIC_TRACKS.length
  return MUSIC_TRACKS[next]
}

/**
 * In-race playlist: energetic rock, drum & bass and electronic, in the spirit
 * of the NFS soundtracks without their (commercially licensed) songs. CC0
 * except "Race" (CC BY 4.0), which the in-race now-playing card and
 * public/audio/music/race/CREDITS.md credit. Files are unchanged downloads,
 * renamed; they live in public/audio/music/race/.
 */
export const RACE_MUSIC_TRACKS = [
  {
    id: 'darkness-road',
    title: 'Darkness Road',
    artist: 'MintoDog',
    file: '/audio/music/race/darkness-road.mp3',
    source: 'https://opengameart.org/content/darkness-roadremake',
    license: 'CC0 1.0',
  },
  {
    id: 'race',
    title: 'Race',
    artist: 'alex089',
    file: '/audio/music/race/race.mp3',
    source: 'https://opengameart.org/content/race-0',
    license: 'CC BY 4.0',
  },
  {
    id: 'final-hour',
    title: 'Final Hour',
    artist: 'isaiah658',
    file: '/audio/music/race/final-hour.mp3',
    source: 'https://opengameart.org/content/final-hour',
    license: 'CC0 1.0',
  },
  {
    id: 'space-ace',
    title: 'Space Ace',
    artist: 'Sudocolon',
    file: '/audio/music/race/space-ace.mp3',
    source: 'https://opengameart.org/content/space-ace',
    license: 'CC0 1.0',
  },
  {
    id: 'action-track',
    title: 'Action Track',
    artist: 'LushoGames',
    file: '/audio/music/race/action-track.mp3',
    source: 'https://opengameart.org/content/action-track',
    license: 'CC0 1.0',
  },
  {
    id: 'the-rush',
    title: 'The Rush',
    artist: 'tebruno99',
    file: '/audio/music/race/the-rush.mp3',
    source: 'https://opengameart.org/content/the-rush',
    license: 'CC0 1.0',
  },
  {
    id: 'darkness-road-climax',
    title: 'Darkness Road (Climax)',
    artist: 'MintoDog',
    file: '/audio/music/race/darkness-road-climax.mp3',
    source: 'https://opengameart.org/content/darkness-roadremake',
    license: 'CC0 1.0',
  },
] as const satisfies readonly MusicTrack[]

/**
 * Shuffled play order like a racing game's radio: every track once before any
 * repeats, never the same track twice in a row across reshuffles. Pure: the
 * caller owns the random source.
 */
export class RacePlaylist {
  private order: number[] = []
  private last = -1
  private readonly count: number
  private readonly random: () => number
  constructor(count: number, random: () => number = Math.random) { this.count = count; this.random = random }

  next(): number {
    if (this.count <= 0) return -1
    if (!this.order.length) {
      this.order = Array.from({ length: this.count }, (_, i) => i)
      for (let i = this.order.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1))
        ;[this.order[i], this.order[j]] = [this.order[j], this.order[i]]
      }
      if (this.count > 1 && this.order[0] === this.last) this.order.push(this.order.shift()!)
    }
    this.last = this.order.shift()!
    return this.last
  }
}
