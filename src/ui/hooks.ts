import { useStore } from 'zustand'
import { gameStore, type GameState } from '../stores/gameStore'
import { telemetryStore, type Telemetry } from '../stores/telemetryStore'
import { accountStore, type AccountState } from '../stores/accountStore'
import { leaderboardStore, type LeaderboardState } from '../stores/leaderboardStore'
import { walletStore } from '../stores/walletStore'
import { careerStore } from '../stores/careerStore'

export const useGame = <T,>(selector: (s: GameState) => T): T => useStore(gameStore, selector)
export const useTelemetry = <T,>(selector: (s: Telemetry) => T): T => useStore(telemetryStore, selector)
export const useAccount = <T,>(selector: (s: AccountState) => T): T => useStore(accountStore, selector)
export const useLeaderboard = (): LeaderboardState => useStore(leaderboardStore)
export const useCareer = <T,>(selector: (s: ReturnType<typeof careerStore.getState>) => T): T => useStore(careerStore, selector)
export const useWallet = <T,>(selector: (s: ReturnType<typeof walletStore.getState>) => T): T => useStore(walletStore, selector)
