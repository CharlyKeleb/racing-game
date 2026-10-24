import { createStore } from 'zustand/vanilla'
import type { IdentityHistoryCursor, IdentityHistoryEntry } from '../cloud/identityHistoryData'
interface IdentityHistoryState {
  playerId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  rows: IdentityHistoryEntry[]
  hasMore: boolean
  cursor: IdentityHistoryCursor | null
  error: string | null
}
export const identityHistoryStore = createStore<IdentityHistoryState>()(() => ({
  playerId: null, status: 'idle', rows: [], hasMore: false, cursor: null, error: null,
}))
export function clearIdentityHistory(playerId: string | null): void {
  identityHistoryStore.setState({ playerId, status: 'idle', rows: [], hasMore: false, cursor: null, error: null })
}
