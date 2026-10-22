import { describe, expect, it } from 'vitest'
import { availableNarrationVariants, hasCommentaryExchange, narrationClip, narrationText, type NarrationId } from '../src/audio/narration'

describe('expanded commentary recordings', () => {
  it.each(['overtake', 'lead', 'lostLead', 'finalLap', 'finish', 'raceComplete'] as NarrationId[])('has three voiced takes per commentator for %s', id => {
    for (const voice of ['alex', 'camille'] as const) {
      expect(availableNarrationVariants(voice, id)).toEqual([0, 1, 2])
      expect(new Set([0, 1, 2].map(variant => narrationText(voice, id, variant))).size).toBe(3)
    }
  })
  it.each(['overtake', 'lead', 'raceComplete'] as NarrationId[])('has both speaker turns and matching subtitles for the %s exchange', id => {
    expect(hasCommentaryExchange(id)).toBe(true)
    for (const voice of ['alex', 'camille'] as const) {
      expect(narrationClip(voice, id, -1)).toBeTruthy()
      expect(narrationText(voice, id, -1)).not.toBe(narrationText(voice, id))
    }
  })
  it('keeps exchanges separate from solo variation selection', () => {
    expect(availableNarrationVariants('alex', 'overtake')).not.toContain(-1)
    expect(hasCommentaryExchange('finish')).toBe(false)
    expect(narrationClip('alex', 'overtake', 99)).toBeUndefined()
  })
})
