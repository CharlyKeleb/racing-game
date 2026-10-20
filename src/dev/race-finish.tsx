import { createRoot } from 'react-dom/client'
import App from '../App'
import { gameStore } from '../stores/gameStore'
import type { Game } from '../engine/Game'
import '../index.css'

// Ephemeral fixture settings: do not overwrite the user's persisted selection.
gameStore.setState({ settings: { ...gameStore.getState().settings, mode: 'quick', track: 'test-circuit', laps: 1, opponents: 1, timeOfDay: 'golden', weather: 'dry' } })
createRoot(document.querySelector('#root')!).render(<App />)
const button = document.createElement('button')
button.textContent = 'Cross finish (dev)'
button.style.cssText = 'position:fixed;left:12px;top:12px;z-index:10000;padding:8px;background:#101b2a;color:white;border:1px solid #789;font:12px system-ui'
button.disabled = true
button.onclick = () => (window as unknown as { __game: Game }).__game.debugFinishRace()
document.body.append(button)
gameStore.subscribe(state => { button.disabled = state.phase !== 'racing'; button.style.display = state.phase === 'finished' ? 'none' : '' })
