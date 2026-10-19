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
