import { createStore } from 'zustand/vanilla'
import type { LobbySnapshot, RaceSnapshot } from '../../server/src/protocol'

export interface LobbyState {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting'
  connectionEpoch: number
  snapshot: LobbySnapshot | null
  raceSnapshot: RaceSnapshot | null
  sessionId: string | null
  error: string | null
}
export const lobbyStore = createStore<LobbyState>()(() => ({ status: 'idle', connectionEpoch: 0, snapshot: null, raceSnapshot: null, sessionId: null, error: null }))
