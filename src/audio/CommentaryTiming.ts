import type { NarrationId } from './narration'

const priority = (id: NarrationId) => id === 'finish' || id === 'raceComplete' ? 4 : id === 'finalLap' ? 3 : id === 'lead' || id === 'lostLead' ? 2 : id === 'overtake' ? 1 : 0
const positionCue = (id: NarrationId) => id === 'lead' || id === 'lostLead' || id === 'overtake'
const GAP_MS = 850
const MAX_AGE_MS = 4000

/** Real playback completion drives turn-taking, rather than the short HUD callout timer. */
export class CommentaryTiming {
  current: NarrationId | null = null
  private queue: { id: NarrationId; at: number }[] = []
  private readyAt = 0
  private lastActivityAt = 0
  private ordinaryAt = -Infinity

  reset(): void { this.current = null; this.queue = []; this.readyAt = 0; this.ordinaryAt = -Infinity; this.lastActivityAt = 0 }

  offer(id: NarrationId, now: number, immediate = false): NarrationId | null {
    if (immediate) { this.queue = []; this.current = null; this.readyAt = 0; return this.start(id, now) }
    if (positionCue(id)) this.queue = this.queue.filter(cue => !positionCue(cue.id))
    if (this.current === id) return null
    if (this.current && priority(id) >= 2 && (priority(id) > priority(this.current) || (priority(id) === 2 && priority(this.current) === 2))) {
      this.queue = this.queue.filter(cue => priority(cue.id) >= priority(id))
      return this.start(id, now)
    }
    this.queue = this.queue.filter(cue => cue.id !== id)
    this.queue.push({ id, at: now })
    this.queue.sort((a, b) => priority(b.id) - priority(a.id) || a.at - b.at)
    this.queue.length = Math.min(2, this.queue.length)
    return this.poll(now)
  }

  complete(now: number): void { this.lastActivityAt = now; this.current = null; this.readyAt = now + GAP_MS }

  quietFor(now: number): number { return this.current || this.queue.length ? 0 : Math.max(0, now - this.lastActivityAt) }

  poll(now: number): NarrationId | null {
    this.queue = this.queue.filter(cue => now - cue.at <= MAX_AGE_MS)
    if (this.current || now < this.readyAt) return null
    const index = this.queue.findIndex(cue => priority(cue.id) >= 2 || now - this.ordinaryAt >= 6000)
    if (index < 0) return null
    return this.start(this.queue.splice(index, 1)[0].id, now)
  }

  private start(id: NarrationId, now: number): NarrationId {
    this.current = id
    this.lastActivityAt = now
    if (priority(id) < 2) this.ordinaryAt = now
    return id
  }
}
