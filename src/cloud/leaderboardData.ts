import type { DriftEventId } from '../racing/driftEvents'
import { formatTime } from '../racing/LapTimer'
import { carClass, performanceRank, sanitizeBuild, type CarClass } from '../vehicles/CarBuild'
import { CARS } from '../vehicles/carRegistry'

/**
 * Global leaderboards: the board a query means, the player's local records as
 * scores to post, and validation of what the server returns. Pure, unit tested.
 * Time Trial boards rank lap ms (lower wins); drift boards rank points (higher wins).
 */

export type LeaderboardMode = 'timeTrial' | 'drift'

export interface LeaderboardQuery {
  mode: LeaderboardMode
  track: string
  /** Drift boards only. */
  event: DriftEventId
  /** Time Trial boards only: one car, or null for every car. */
  car: string | null
}

export interface LeaderboardRow {
  rank: number
  entrants: number
  display_name: string
  car_id: string
  build_key: string | null
  score: number
  set_at: string
  is_me: boolean
}

export type LeaderboardEntry =
  | { kind: 'trial'; track: string; car: string; build: string; score: number }
  | { kind: 'drift'; track: string; event: DriftEventId; score: number }

export const SUBMIT_BATCH = 64
const MAX_ROWS = 51
const TRIAL_KEY = /^racing-game:trial:([a-z0-9-]+):([a-z0-9-]+):(e[0-3]-t(?:street|sport|race)-s(?:stock|sport|race)-w[0-2]-b[0-2]):v1$/
const DRIFT_KEY = /^racing-game:drift:([a-z0-9-]+):(flow|sprint|endurance):course-v1$/
const BUILD_KEY = /^e([0-3])-t(street|sport|race)-s(stock|sport|race)-w([0-2])-b([0-2])$/

export function boardId(query: Pick<LeaderboardQuery, 'mode' | 'track' | 'event'>): string {
  return query.mode === 'drift' ? `drift:${query.track}:${query.event}` : `trial:${query.track}`
}

/** Same board and car filter: a refresh, not a new list. */
export function sameQuery(a: LeaderboardQuery | null, b: LeaderboardQuery | null): boolean {
  return !!a && !!b && boardId(a) === boardId(b) && (a.mode === 'drift' || a.car === b.car)
}

function recordNumber(raw: string, field: 'lapMs' | 'score'): number | null {
  try {
    const value = (JSON.parse(raw) as Record<string, unknown> | null)?.[field]
    return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.round(value) : null
  } catch {
    return null
  }
}

/**
 * The best score per board and car from a save snapshot's entries. Time Trial
 * records are per build; a board shows the player's fastest build of each car.
 */
export function collectBests(entries: Record<string, string>): LeaderboardEntry[] {
  const bests = new Map<string, LeaderboardEntry>()
  for (const [key, raw] of Object.entries(entries)) {
    const trial = TRIAL_KEY.exec(key)
    if (trial) {
      const score = recordNumber(raw, 'lapMs')
      const held = bests.get(`trial:${trial[1]}:${trial[2]}`)
      if (score !== null && (!held || score < held.score)) bests.set(`trial:${trial[1]}:${trial[2]}`, { kind: 'trial', track: trial[1], car: trial[2], build: trial[3], score })
      continue
    }
    const drift = DRIFT_KEY.exec(key)
    if (drift) {
      const score = recordNumber(raw, 'score')
      if (score !== null) bests.set(`drift:${drift[1]}:${drift[2]}`, { kind: 'drift', track: drift[1], event: drift[2] as DriftEventId, score })
    }
  }
  return [...bests.values()]
}

export function entryKey(entry: LeaderboardEntry): string {
  return entry.kind === 'trial' ? `trial:${entry.track}:${entry.car}` : `drift:${entry.track}:${entry.event}`
}

/** Bests the server hasn't had from this session: new boards, or better than what was sent. */
export function unsentBests(bests: LeaderboardEntry[], sent: ReadonlyMap<string, number>): LeaderboardEntry[] {
  return bests.filter((entry) => {
    const previous = sent.get(entryKey(entry))
    return previous === undefined || (entry.kind === 'trial' ? entry.score < previous : entry.score > previous)
  })
}

const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max

/** Server rows, ranked. Anything unexpected is an error rather than a wrong-looking board. */
export function parseLeaderboard(value: unknown): LeaderboardRow[] {
  if (!Array.isArray(value) || value.length > MAX_ROWS) throw new Error('Invalid leaderboard page')
  let previous = 0
  return value.map((row: LeaderboardRow) => {
    if (!row || !integer(row.rank, previous + 1, Number.MAX_SAFE_INTEGER) || !integer(row.entrants, row.rank, Number.MAX_SAFE_INTEGER)
      || typeof row.display_name !== 'string' || !row.display_name || typeof row.car_id !== 'string'
      || (row.build_key !== null && typeof row.build_key !== 'string') || !integer(row.score, 1, 2_000_000_000)
      || typeof row.is_me !== 'boolean' || typeof row.set_at !== 'string' || !Number.isFinite(Date.parse(row.set_at))) throw new Error('Invalid leaderboard row')
    previous = row.rank
    return { rank: row.rank, entrants: row.entrants, display_name: row.display_name, car_id: row.car_id, build_key: row.build_key, score: row.score, set_at: row.set_at, is_me: row.is_me }
  })
}

/** The performance class a lap was set in, from the car and its build key. */
export function buildClass(car: string, buildKey: string | null): CarClass | null {
  const m = buildKey ? BUILD_KEY.exec(buildKey) : null
  const stock = CARS.find((c) => c.id === car)?.stats
  if (!m || !stock) return null
  const build = sanitizeBuild({ engine: Number(m[1]), tires: m[2], suspension: m[3], weight: Number(m[4]), brakes: Number(m[5]) })
  return carClass(performanceRank(build, stock))
}

export function formatScore(mode: LeaderboardMode, score: number): string {
  return mode === 'drift' ? score.toLocaleString() : formatTime(score)
}

/** The distance to the leader: "+1.204" seconds, or "−1,250" points. */
export function formatGap(mode: LeaderboardMode, score: number, leader: number): string {
  if (mode === 'drift') return `−${(leader - score).toLocaleString()}`
  const ms = score - leader
  return ms >= 60_000 ? `+${formatTime(ms)}` : `+${(ms / 1000).toFixed(3)}`
}
