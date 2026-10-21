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

it('avoids repeating a take for the same speaker and event when alternatives are recorded', () => {
  const director = new CommentaryDirector(() => 0)
  const available = () => [0, 1, 2]
  const first = director.chooseTake('alex', 'overtake', available)
  const next = director.chooseTake('alex', 'overtake', available)
  expect(first).toEqual({ speaker: 'alex', variant: 0 })
  expect(next).toEqual({ speaker: 'alex', variant: 1 })
  expect(director.chooseTake('alex', 'lead', available)?.variant).toBe(0)
})

it('does not select a new variation until its recording is available', () => {
  const director = new CommentaryDirector(() => .99)
  const baseOnly = () => [0]
  for (let i = 0; i < 10; i++) expect(director.chooseTake('duo', 'overtake', baseOnly)?.variant).toBe(0)
  expect(director.chooseTake('duo', 'lead', () => [])).toBeNull()
})

it('only selects occasional complete exchanges in duo mode, spaced 45 seconds apart', () => {
  const director = new CommentaryDirector(() => 0)
  expect(director.chooseExchange('alex', 'lead', () => true, 0)).toBe(false)
  expect(director.chooseExchange('duo', 'lead', () => false, 0)).toBe(false)
  expect(director.chooseExchange('duo', 'lead', () => true, 0)).toBe(true)
  director.markExchangeHeard()
  expect(director.chooseExchange('duo', 'overtake', () => true, 44999)).toBe(false)
  expect(director.chooseExchange('duo', 'raceComplete', () => true, 45000)).toBe(true)
  const quietDirector = new CommentaryDirector(() => .9)
  expect(quietDirector.chooseExchange('duo', 'lead', () => true, 0)).toBe(true)
  quietDirector.markExchangeHeard()
  expect(quietDirector.chooseExchange('duo', 'lead', () => true, 45000)).toBe(false)
})

it('does not start an exchange with a third consecutive Alex line', () => {
  const director = new CommentaryDirector(() => 0)
  director.markExchangeHeard()
  director.recordSpeaker('alex')
  director.recordSpeaker('alex')
  expect(director.chooseExchange('duo', 'lead', () => true, 0)).toBe(false)
  director.recordSpeaker('camille')
  expect(director.chooseExchange('duo', 'lead', () => true, 0)).toBe(true)
})


it('retries at the finish if the first exchange was interrupted before Camille spoke', () => {
  const director = new CommentaryDirector(() => .99)
  expect(director.chooseExchange('duo', 'lead', () => true, 10000)).toBe(true)
  expect(director.needsExchange).toBe(true)
  expect(director.chooseExchange('duo', 'raceComplete', () => true, 15000)).toBe(true)
  director.markExchangeHeard()
  expect(director.needsExchange).toBe(false)
  director.startRace()
  expect(director.needsExchange).toBe(true)
  expect(director.chooseExchange('duo', 'overtake', () => true, 16000)).toBe(true)
})
