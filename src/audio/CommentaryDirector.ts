import type { NarrationId, Narrator, NarratorVoice } from './narration'

/** Choose once per event, independently of rendering and subtitle animation. */
export class CommentaryDirector {
  private last: NarratorVoice | null = null
  private streak = 0
  private lastExchangeAt = -Infinity
  private exchangeHeard = false
  private readonly previousTakes = new Map<string, number>()
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

  chooseTake(mode: Narrator, id: NarrationId, available: (voice: NarratorVoice, id: NarrationId) => readonly number[]): { speaker: NarratorVoice; variant: number } | null {
    const speaker = this.choose(mode, id, (voice, event) => available(voice, event).length > 0)
    if (!speaker) return null
    const takes = available(speaker, id)
    const key = `${speaker}:${id}`
    const fresh = takes.filter(take => take !== this.previousTakes.get(key))
    const candidates = fresh.length ? fresh : takes
    const variant = candidates.length ? candidates[Math.min(candidates.length - 1, Math.floor(this.random() * candidates.length))] : 0
    this.previousTakes.set(key, variant)
    return { speaker, variant }
  }


  get needsExchange(): boolean { return !this.exchangeHeard }
  startRace(): void { this.exchangeHeard = false; this.lastExchangeAt = -Infinity }
  markExchangeHeard(): void { this.exchangeHeard = true }

  /** Introduce the duo on the first eligible event; later exchanges remain occasional. */
  chooseExchange(mode: Narrator, id: NarrationId, available: (id: NarrationId) => boolean, now: number): boolean {
    if (mode !== 'duo' || !available(id)) return false
    const first = !this.exchangeHeard
    const finishFallback = first && id === 'raceComplete'
    if (!finishFallback && now - this.lastExchangeAt < 45000) return false
    if (!first && ((this.last === 'alex' && this.streak >= 2) || this.random() >= .24)) return false
    this.lastExchangeAt = now
    return true
  }

  recordSpeaker(speaker: NarratorVoice): void {
    this.streak = speaker === this.last ? this.streak + 1 : 1
    this.last = speaker
  }

}
