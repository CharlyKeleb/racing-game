import { createStore } from 'zustand/vanilla'
import type { HistoryCursor, PracticeHistoryEntry } from '../cloud/practiceHistoryData'
interface RaceHistoryState {
  playerId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  rows: PracticeHistoryEntry[]
  hasMore: boolean
  cursor: HistoryCursor | null
  error: string | null
}
export const raceHistoryStore = createStore<RaceHistoryState>()(() => ({ playerId: null, status: 'idle', rows: [], hasMore: false, cursor: null, error: null }))
export function clearRaceHistory(playerId: string | null): void {
  raceHistoryStore.setState({ playerId, status: 'idle', rows: [], hasMore: false, cursor: null, error: null })
}
