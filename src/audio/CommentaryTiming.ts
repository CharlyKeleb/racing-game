import type { NarrationId } from './narration'

const priority = (id: NarrationId) => id === 'finish' || id === 'raceComplete' ? 4 : id === 'finalLap' ? 3 : id === 'lead' || id === 'lostLead' ? 2 : id === 'overtake' ? 1 : 0
const positionCue = (id: NarrationId) => id === 'lead' || id === 'lostLead' || id === 'overtake'
/** Coaching and fill: nothing happened at a particular moment, so anything that did happens may cut in. */
const filler = (id: NarrationId) => id === 'focus' || id === 'rhythm' || id === 'driftFlow' || id === 'driftSetup' || id === 'quickTip'
/** Breath after ordinary speech; a race event that was waiting goes sooner. */
const GAP_MS = 850
const EVENT_GAP_MS = 300
const MAX_AGE_MS = 4000
/** "Nice move" more than this after the pass (its chime and HUD banner) describes the wrong moment. */
const POSITION_MAX_AGE_MS = 2000
const FILLER_SPACING_MS = 6000

/** Real playback completion drives turn-taking, rather than the short HUD callout timer. */
export class CommentaryTiming {
  current: NarrationId | null = null
  private queue: { id: NarrationId; at: number }[] = []
  private completedAt = -Infinity
  private lastActivityAt = 0
  private ordinaryAt = -Infinity

  reset(): void { this.current = null; this.queue = []; this.completedAt = -Infinity; this.ordinaryAt = -Infinity; this.lastActivityAt = 0 }

  offer(id: NarrationId, now: number, immediate = false): NarrationId | null {
    if (immediate) { this.queue = []; this.current = null; this.completedAt = -Infinity; return this.start(id, now) }
    if (positionCue(id)) this.queue = this.queue.filter(cue => !positionCue(cue.id))
    if (this.current === id) return null
    // A race event speaks over coaching, so the line lands with its chime; a pass waits for a
    // scripted line (welcome, "Go!"), while bigger news cuts in over it or a smaller event.
    const current = this.current
    const outranks = priority(id) >= 2 && (priority(id) > priority(current ?? 'focus') || (priority(id) === 2 && priority(current ?? 'focus') === 2))
    if (current && priority(id) >= 1 && (filler(current) || outranks)) {
      this.queue = this.queue.filter(cue => priority(cue.id) >= priority(id) && !filler(cue.id))
      return this.start(id, now)
    }
    this.queue = this.queue.filter(cue => cue.id !== id)
    this.queue.push({ id, at: now })
    this.queue.sort((a, b) => priority(b.id) - priority(a.id) || a.at - b.at)
    this.queue.length = Math.min(2, this.queue.length)
    return this.poll(now)
  }

  complete(now: number): void { this.lastActivityAt = now; this.current = null; this.completedAt = now }

  quietFor(now: number): number { return this.current || this.queue.length ? 0 : Math.max(0, now - this.lastActivityAt) }

  poll(now: number): NarrationId | null {
    this.queue = this.queue.filter(cue => now - cue.at <= (positionCue(cue.id) ? POSITION_MAX_AGE_MS : MAX_AGE_MS))
    if (this.current) return null
    const index = this.queue.findIndex(cue => now - this.completedAt >= (priority(cue.id) >= 1 ? EVENT_GAP_MS : GAP_MS) &&
      (!filler(cue.id) || now - this.ordinaryAt >= FILLER_SPACING_MS))
    if (index < 0) return null
    return this.start(this.queue.splice(index, 1)[0].id, now)
  }

  private start(id: NarrationId, now: number): NarrationId {
    this.current = id
    this.lastActivityAt = now
    if (filler(id)) this.ordinaryAt = now
    return id
  }
}
