import { createStore } from 'zustand/vanilla'
import type { LeaderboardQuery, LeaderboardRow } from '../cloud/leaderboardData'

/** The board on show, written by cloud/Leaderboards.ts. 'offline': this build has no Supabase. */
export interface LeaderboardState {
  query: LeaderboardQuery | null
  status: 'idle' | 'loading' | 'ready' | 'error' | 'offline'
  rows: LeaderboardRow[]
}

export const leaderboardStore = createStore<LeaderboardState>()(() => ({ query: null, status: 'idle', rows: [] }))
