import type { SupabaseClient } from '@supabase/supabase-js'
import { accountStore } from '../stores/accountStore'
import { leaderboardStore } from '../stores/leaderboardStore'
import { boardId, collectBests, entryKey, parseLeaderboard, sameQuery, SUBMIT_BATCH, unsentBests, type LeaderboardQuery } from './leaderboardData'
import { readSnapshot } from './saveData'

const SYNC_DELAY_MS = 2000
const TIMEOUT_MS = 8000

/**
 * Posts the signed-in player's local bests and reads the global boards
 * (docs/LEADERBOARDS.md). localStorage stays the source: every sync works out
 * what the server hasn't had, so a lap set offline or as a guest posts later.
 */
export class Leaderboards {
  private readonly client: () => Promise<SupabaseClient | null>
  private readonly player: () => string | null
  /** False until this player's cloud save has merged, so another player's records never post. */
  private readonly saveMerged: () => boolean
  private readonly unwatch: () => void
  /** Scores the server has answered for this session, by board and car. */
  private sent = new Map<string, number>()
  private posted = 0
  private syncing: Promise<void> = Promise.resolve()
  private timer: ReturnType<typeof setTimeout> | null = null
  private request = 0
  private abort?: AbortController
  private disposed = false

  constructor(client: () => Promise<SupabaseClient | null>, player: () => string | null, saveMerged: () => boolean) {
    this.client = client; this.player = player; this.saveMerged = saveMerged
    this.unwatch = accountStore.subscribe((state, previous) => {
      if (state.player?.id !== previous.player?.id) {
        this.sent = new Map()
        // Who "you" are on the board just changed.
        const { query } = leaderboardStore.getState()
        if (query) void this.load(query)
      }
      if (state.localSaves !== previous.localSaves || (state.profile && !previous.profile)) this.scheduleSync()
    })
  }

  /** New records have landed: post them shortly. */
  scheduleSync(): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.syncAndRefresh(), SYNC_DELAY_MS)
  }

  /** Shows a board, posting anything unsent first so the player's latest time is on it. */
  async load(query: LeaderboardQuery): Promise<void> {
    const request = ++this.request
    this.abort?.abort()
    const abort = this.abort = new AbortController()
    const state = leaderboardStore.getState()
    // A refresh keeps its rows on screen; a different board mustn't show the old one's.
    leaderboardStore.setState(sameQuery(state.query, query) && state.rows.length ? { query, status: 'ready' } : { query, status: 'loading', rows: [] })
    const client = await this.client()
    if (this.disposed || request !== this.request) return
    if (!client) { leaderboardStore.setState({ status: 'offline', rows: [] }); return }
    await this.sync()
    if (this.disposed || request !== this.request) return
    try {
      const { data, error } = await client.rpc('leaderboard_top', { board_id: boardId(query), car_filter: query.mode === 'timeTrial' ? query.car : null })
        .abortSignal(AbortSignal.any([abort.signal, AbortSignal.timeout(TIMEOUT_MS)]))
      if (this.disposed || request !== this.request) return
      if (error) throw error
      leaderboardStore.setState({ status: 'ready', rows: parseLeaderboard(data) })
    } catch {
      if (!this.disposed && request === this.request) leaderboardStore.setState({ status: 'error' })
    }
  }

  dispose(): void {
    this.disposed = true
    this.request++
    this.abort?.abort()
    if (this.timer) clearTimeout(this.timer)
    this.unwatch()
  }

  private async syncAndRefresh(): Promise<void> {
    const before = this.posted
    await this.sync()
    const { query } = leaderboardStore.getState()
    if (query && !this.disposed && this.posted !== before) void this.load(query)
  }

  /** One at a time: a later caller waits, then finds only what's still unsent. */
  private sync(): Promise<void> {
    this.syncing = this.syncing.then(() => this.post()).catch(() => {})
    return this.syncing
  }

  private async post(): Promise<void> {
    const client = await this.client(), playerId = this.player()
    if (!client || !playerId || this.disposed || !this.saveMerged() || !accountStore.getState().profile) return
    const bests = unsentBests(collectBests(readSnapshot(localStorage).entries), this.sent)
    for (let i = 0; i < bests.length; i += SUBMIT_BATCH) {
      const batch = bests.slice(i, i + SUBMIT_BATCH)
      const { error } = await client.rpc('submit_leaderboard_scores', { entries: batch }).abortSignal(AbortSignal.timeout(TIMEOUT_MS))
      // Offline or the table isn't deployed yet: the records keep, the next sync retries.
      if (error || this.disposed || this.player() !== playerId) return
      for (const entry of batch) this.sent.set(entryKey(entry), entry.score)
      this.posted++
    }
  }
}
