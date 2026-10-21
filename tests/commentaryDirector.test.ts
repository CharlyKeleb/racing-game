import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { CommentaryDirector } from '../src/audio/CommentaryDirector'
import { CAMILLE_NARRATION, NARRATION, narrationText, type NarrationId } from '../src/audio/narration'

const available = () => true
describe('commentary duo', () => {
  it('allows either commentator to handle the same event', () => {
    expect(new CommentaryDirector(() => 0).choose('duo', 'lead', available)).toBe('alex')
    expect(new CommentaryDirector(() => .99).choose('duo', 'lead', available)).toBe('camille')
  })
  it('allows repeats but prevents more than two lines from one voice', () => {
    const director = new CommentaryDirector(() => 0)
    const voices = Array.from({ length: 9 }, () => director.choose('duo', 'overtake', available))
    expect(voices.slice(0, 3)).toEqual(['alex', 'alex', 'camille'])
    for (let i = 2; i < voices.length; i++) expect(new Set(voices.slice(i - 2, i + 1)).size).toBeGreaterThan(1)
  })
  it('uses an installed recording if the other voice is unavailable', () => {
    const director = new CommentaryDirector(() => 0)
    for (let i = 0; i < 4; i++) expect(director.choose('duo', 'finish', voice => voice === 'camille')).toBe('camille')
    expect(director.choose('duo', 'finish', () => false)).toBeNull()
    expect(director.choose('off', 'finish', available)).toBeNull()
  })
  it('honors explicit single-voice choices', () => {
    const director = new CommentaryDirector(() => 0)
    expect(director.choose('camille', 'lead', available)).toBe('camille')
    expect(director.choose('alex', 'lead', available)).toBe('alex')
  })
  it('has distinct captions and installed clips for every event in both packs', () => {
    for (const id of Object.keys(NARRATION) as NarrationId[]) {
      expect(CAMILLE_NARRATION[id]).not.toBe(NARRATION[id])
      for (const voice of ['alex', 'camille'] as const) {
        expect(existsSync(new URL(`../src/assets/narrators/${voice}/${id}.mp3`, import.meta.url))).toBe(true)
        expect(narrationText(voice, id)).toBe(voice === 'alex' ? NARRATION[id] : CAMILLE_NARRATION[id])
      }
    }
  })
})
