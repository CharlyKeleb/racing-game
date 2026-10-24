import type { SupabaseClient } from '@supabase/supabase-js'
import { accountStore } from '../stores/accountStore'
import { clearIdentityHistory, identityHistoryStore } from '../stores/identityHistoryStore'
import { parseIdentityHistoryPage } from './identityHistoryData'

/** Private, bounded pages; account changes invalidate even a response already in flight. */
export class IdentityHistory {
  private request = 0
  private abort?: AbortController
  private disposed = false
  private readonly unwatch: () => void
  private readonly client: () => Promise<SupabaseClient | null>
  private readonly player: () => string | null
  constructor(client: () => Promise<SupabaseClient | null>, player: () => string | null) {
    this.client = client; this.player = player
    this.unwatch = accountStore.subscribe((state, previous) => {
      if (state.player?.id !== previous.player?.id) this.clear(state.player?.id ?? null)
    })
  }
  async load(more = false): Promise<void> {
    const playerId = this.player()
    if (this.disposed || !playerId || accountStore.getState().player?.id !== playerId) return
    const state = identityHistoryStore.getState()
    if (more && (state.playerId !== playerId || state.status === 'loading' || !state.hasMore || !state.cursor)) return
    const cursor = more ? state.cursor : null, request = ++this.request
    this.abort?.abort()
    const abort = this.abort = new AbortController()
    identityHistoryStore.setState({ playerId, status: 'loading', error: null,
      ...(!more ? { rows: [], hasMore: false, cursor: null } : {}) })
    try {
      const client = await this.client()
      if (!this.current(request, playerId)) return
      if (!client) throw new Error('Account unavailable')
      const { data, error } = await client.rpc('my_racer_identity_history', cursor ? { before_at: cursor.at, before_id: cursor.id } : {})
        .abortSignal(AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]))
      if (!this.current(request, playerId)) return
      if (error) throw error
      const page = parseIdentityHistoryPage(data, playerId), rows = page.slice(0, 20), last = rows.at(-1)
      identityHistoryStore.setState({ status: 'ready', rows, hasMore: page.length > 20,
        cursor: last ? { at: last.recorded_at, id: last.event_id } : null })
    } catch {
      if (this.current(request, playerId)) identityHistoryStore.setState({ status: 'error', error: 'Could not load your name history. Please retry.' })
    }
  }
  /** After a successful profile save, invalidate old pages without starting a hidden request. */
  invalidate(): void { this.clear(this.player()) }
  dispose(): void { this.disposed = true; this.clear(null); this.unwatch() }
  private clear(playerId: string | null): void {
    this.request++; this.abort?.abort(); clearIdentityHistory(playerId)
  }
  private current(request: number, playerId: string): boolean {
    return !this.disposed && request === this.request && this.player() === playerId && accountStore.getState().player?.id === playerId
  }
}
