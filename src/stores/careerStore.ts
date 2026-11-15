import { createStore } from 'zustand/vanilla'
import { careerEvent, careerPassed, careerStatus, type CareerOutcome } from '../racing/Career'

export const CAREER_KEY = 'racing-game:career'

/** What the last career event you drove came to, for the results screen and the ladder. */
export interface CareerResult {
  eventId: string
  passed: boolean
  outcome: CareerOutcome
  /** True the first time this event is won. */
  firstWin: boolean
}

interface CareerState {
  /** Events won, by id (saved, cloud-synced). */
  won: string[]
  /** The event being driven, or null outside a career event. */
  active: string | null
  /** The quick-race setup before a career event took it over, put back afterwards. */
  stash: Record<string, unknown> | null
  lastResult: CareerResult | null
  /** Open the menu on the Career tab (after leaving an event with Back to career). */
  showLadder: boolean
  begin(eventId: string, stash: Record<string, unknown>): void
  /** Records the active event's outcome (once per run). */
  record(outcome: CareerOutcome): CareerResult | null
  /** Leaves the event: returns the stashed setup to restore, if any. */
  end(): Record<string, unknown> | null
  reset(): void
  reloadSaved(): void
}

function readWon(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(CAREER_KEY) ?? '{}') as { won?: unknown }
    return Array.isArray(saved.won) ? saved.won.filter((id): id is string => typeof id === 'string' && !!careerEvent(id)) : []
  } catch {
    return []
  }
}

function save(won: string[]): void {
  try {
    localStorage.setItem(CAREER_KEY, JSON.stringify({ won }))
  } catch {
    // Storage unavailable: progress lasts this session only.
  }
}

export const careerStore = createStore<CareerState>((set, get) => ({
  won: readWon(),
  active: null,
  stash: null,
  lastResult: null,
  showLadder: false,
  begin: (eventId, stash) => {
    // Only an open event can be driven: a locked rung stays locked.
    if (careerStatus(eventId, new Set(get().won)) === 'locked') return
    set({ active: eventId, stash: get().stash ?? stash, lastResult: null })
  },
  record: (outcome) => {
    const { active, won, lastResult } = get()
    const event = active ? careerEvent(active) : undefined
    if (!event || lastResult?.eventId === event.id) return lastResult
    const passed = careerPassed(event, outcome)
    const firstWin = passed && !won.includes(event.id)
    const next = firstWin ? [...won, event.id] : won
    if (firstWin) save(next)
    const result = { eventId: event.id, passed, outcome, firstWin }
    set({ won: next, lastResult: result })
    return result
  },
  end: () => {
    const stash = get().stash
    set({ active: null, stash: null })
    return stash
  },
  reset: () => {
    save([])
    set({ won: [], lastResult: null })
  },
  reloadSaved: () => set({ won: readWon() }),
}))
