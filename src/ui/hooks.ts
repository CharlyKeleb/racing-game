import { useStore } from 'zustand'
import { gameStore, type GameState } from '../stores/gameStore'
import { telemetryStore, type Telemetry } from '../stores/telemetryStore'

export const useGame = <T,>(selector: (s: GameState) => T): T => useStore(gameStore, selector)
export const useTelemetry = <T,>(selector: (s: Telemetry) => T): T => useStore(telemetryStore, selector)
