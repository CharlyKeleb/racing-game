/**
 * Quick Race callouts (#90): a completed overtake, taking or losing the lead,
 * the final lap and a photo finish. Pure and clocked on race time (ms), so a
 * pause doesn't age the queue. Fed from the standings the HUD already uses
 * (overtake hysteresis included), a few times a second.
 *
 * Kept apart from the drift messages and the proximity spotter.
 */

export type CalloutKind = 'finish' | 'finalLap' | 'lead' | 'lostLead' | 'overtake'

export interface Callout {
  /** Unique per callout, so the HUD replays its animation. */
  id: number
  kind: CalloutKind
  text: string
  detail: string
  /** Race time it went on screen, ms. */
  at: number
}

export interface CalloutSample {
  /** Race clock, ms (LapTimer.totalMs). */
  timeMs: number
  /** Player position (1-based) and field size. */
  position: number
  fieldSize: number
  lap: number
  totalLaps: number
  /** The player has crossed the line. */
  finished: boolean
  /** Time to the nearest car at the player's finish, ms; null when nobody was close enough to tell. */
  finishGapMs: number | null
}

/** A position change must hold this long to count: side-by-side flicker never does. */
export const SUSTAIN_MS = 1200
/** How long a callout stays up. */
export const DISPLAY_MS = 2200
/** A finish this close is a photo finish. */
export const PHOTO_FINISH_MS = 600
/** Queued callouts older than this are dropped rather than shown late. */
const STALE_MS = 4000
const QUEUE_MAX = 3
const PRIORITY: Record<CalloutKind, number> = { finish: 4, finalLap: 3, lead: 2, lostLead: 2, overtake: 1 }
const COOLDOWN_MS: Record<CalloutKind, number> = { finish: 0, finalLap: 0, lead: 4000, lostLead: 4000, overtake: 3000 }

export class RaceCallouts {
  current: Callout | null = null
  private readonly queue: Callout[] = []
  private readonly lastShown = new Map<CalloutKind, number>()
  /** Position last announced or settled on. */
  private settled = 0
  private candidate = 0
  private candidateSince = 0
  private quietUntil = -Infinity
  private finalLapDone = false
  private finishDone = false
  private nextId = 1

  /** New race (start or restart): nothing pending, nothing announced. */
  reset(): void {
    this.current = null
    this.queue.length = 0
    this.lastShown.clear()
    this.settled = this.candidate = 0
    this.candidateSince = 0
    this.quietUntil = -Infinity
    this.finalLapDone = this.finishDone = false
  }

  /** After a checkpoint reset: places lost to the reset settle silently instead of being called out. */
  quiet(timeMs: number, forMs = 3000): void {
    this.quietUntil = timeMs + forMs
  }

  /** @returns a callout that went on screen this update (for its sound), else null. */
  update(s: CalloutSample): Callout | null {
    const now = s.timeMs
    if (!this.finishDone) this.trackPosition(s, now)
    if (!this.finalLapDone && s.totalLaps > 1 && s.lap === s.totalLaps && !s.finished) {
      this.finalLapDone = true
      this.push('finalLap', 'Final lap', '', now)
    }
    if (!this.finishDone && s.finished) {
      this.finishDone = true
      // Overtakes and lead changes still queued are moot once you're across the line.
      this.queue.length = 0
      if (s.finishGapMs !== null && s.finishGapMs < PHOTO_FINISH_MS && s.fieldSize > 1) {
        this.push('finish', 'Photo finish', `${(s.finishGapMs / 1000).toFixed(3)} s`, now)
      }
    }
    return this.show(now)
  }

  private trackPosition(s: CalloutSample, now: number): void {
    if (s.fieldSize < 2 || s.position < 1) return
    if (this.settled === 0) {
      this.settled = this.candidate = s.position
      this.candidateSince = now
      return
    }
    if (s.position !== this.candidate) {
      this.candidate = s.position
      this.candidateSince = now
    }
    if (this.candidate === this.settled || now - this.candidateSince < SUSTAIN_MS) return
    const from = this.settled, to = this.candidate
    this.settled = to
    if (now < this.quietUntil) return
    if (to < from) {
      if (to === 1) this.push('lead', 'Into the lead', 'P1', now)
      else this.push('overtake', 'Overtake', `P${to}`, now)
    } else if (from === 1) {
      this.push('lostLead', 'Lost the lead', `P${to}`, now)
    }
  }

  private push(kind: CalloutKind, text: string, detail: string, now: number): void {
    const last = this.lastShown.get(kind)
    if (last !== undefined && now - last < COOLDOWN_MS[kind]) return
    // One of each kind waiting at most: a newer overtake replaces an older one.
    const same = this.queue.findIndex((c) => c.kind === kind)
    if (same >= 0) this.queue.splice(same, 1)
    this.queue.push({ id: this.nextId++, kind, text, detail, at: now })
    this.queue.sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || a.at - b.at)
    this.queue.length = Math.min(this.queue.length, QUEUE_MAX)
  }

  private show(now: number): Callout | null {
    while (this.queue.length && now - this.queue[0].at > STALE_MS) this.queue.shift()
    const next = this.queue[0]
    if (this.current && now - this.current.at >= DISPLAY_MS) this.current = null
    if (!next) return null
    // Wait for the current one, unless the next outranks it.
    if (this.current && PRIORITY[next.kind] <= PRIORITY[this.current.kind]) return null
    this.queue.shift()
    this.current = { ...next, at: now }
    this.lastShown.set(next.kind, now)
    return this.current
  }
}
