import { createStore } from 'zustand/vanilla'
import type { LobbySnapshot, RaceSnapshot } from '../../server/src/protocol'

export interface LobbyState {
  status: 'idle' | 'connecting' | 'connected'
  snapshot: LobbySnapshot | null
  raceSnapshot: RaceSnapshot | null
  sessionId: string | null
  error: string | null
}
export const lobbyStore = createStore<LobbyState>()(() => ({ status: 'idle', snapshot: null, raceSnapshot: null, sessionId: null, error: null }))
