import type { NarrationId, Narrator, NarratorVoice } from './narration'

/** Choose once per event, independently of rendering and subtitle animation. */
export class CommentaryDirector {
  private last: NarratorVoice | null = null
  private streak = 0
  private readonly random: () => number
  constructor(random: () => number = Math.random) { this.random = random }

  choose(mode: Narrator, id: NarrationId, available: (voice: NarratorVoice, id: NarrationId) => boolean): NarratorVoice | null {
    if (mode === 'off') return null
    if (mode !== 'duo') return mode
    const candidates = (['alex', 'camille'] as const).filter(voice => available(voice, id))
    if (!candidates.length) return null
    const other = candidates.find(voice => voice !== this.last)
    const voice = this.streak >= 2 && other ? other : candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))]
    this.streak = voice === this.last ? this.streak + 1 : 1
    this.last = voice
    return voice
  }
}
