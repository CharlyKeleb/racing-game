import type { SupabaseClient } from '@supabase/supabase-js'
import { accountStore } from '../stores/accountStore'
import { clearRaceHistory, raceHistoryStore } from '../stores/raceHistoryStore'
import { parseHistoryPage } from './practiceHistoryData'

/** Read-only authenticated history, separate from editable offline cloud saves. */
export class PracticeHistory {
  private request = 0
  private abort?: AbortController
  private disposed = false
  private readonly unwatch: () => void
  private readonly client: () => Promise<SupabaseClient | null>
  private readonly player: () => string | null
  constructor(client: () => Promise<SupabaseClient | null>, player: () => string | null) {
    this.client = client; this.player = player
    this.unwatch = accountStore.subscribe((state, previous) => {
      if (state.player?.id !== previous.player?.id) {
        this.request++; this.abort?.abort()
        clearRaceHistory(state.player?.id ?? null)
      }
    })
  }
  async load(more = false): Promise<void> {
    const client = await this.client(), playerId = this.player()
    if (!client || !playerId || this.disposed || accountStore.getState().player?.id !== playerId) return
    const state = raceHistoryStore.getState()
    if (more && (state.playerId !== playerId || state.status === 'loading' || !state.hasMore || !state.cursor)) return
    const cursor = more ? state.cursor : null
    const request = ++this.request
    this.abort?.abort(); this.abort = new AbortController()
    raceHistoryStore.setState({ playerId, status: 'loading', error: null, ...(!more ? { rows: [], hasMore: false, cursor: null } : {}) })
    try {
      const { data, error } = await client.rpc('my_online_practice_history', cursor ? { before_at: cursor.at, before_id: cursor.id } : {})
        .abortSignal(AbortSignal.any([this.abort.signal, AbortSignal.timeout(8000)]))
      if (!this.current(request, playerId)) return
      if (error) throw error
      const page = parseHistoryPage(data, playerId)
      const visible = page.slice(0, 20)
      const last = visible.at(-1)
      raceHistoryStore.setState({ status: 'ready', rows: visible, hasMore: page.length > 20,
        cursor: last ? { at: last.recorded_at, id: last.race_id } : null })
    } catch {
      if (this.current(request, playerId)) raceHistoryStore.setState({ status: 'error', error: 'Could not load your race history. Please retry.' })
    }
  }
  dispose(): void { this.disposed = true; this.request++; this.abort?.abort(); this.unwatch() }
  private current(request: number, playerId: string): boolean {
    return !this.disposed && request === this.request && this.player() === playerId && accountStore.getState().player?.id === playerId
  }
}
