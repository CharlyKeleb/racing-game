// Explicit browser test fixture, outside the production build. No real account or token.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from 'zustand'
import { resultPlayers } from '../helpers/resultRecord'
import { raceHistoryStore } from '../../src/stores/raceHistoryStore'
import { parseHistoryPage } from '../../src/cloud/practiceHistoryData'
import App from '../../src/App'
import '../../src/index.css'
import { accountStore } from '../../src/stores/accountStore'
import { lobbyStore, enterLobby } from '../../src/multiplayer/LobbyClient'
import type { Game } from '../../src/engine/Game'
if (!import.meta.env.DEV || !['http://127.0.0.1:2569', 'http://127.0.0.1:2571'].includes(import.meta.env.VITE_MULTIPLAYER_URL)) throw new Error('This fixture only connects to its dedicated localhost test server')
const player = new URL(location.href).searchParams.get('player') === 'two' ? 'two' : 'one'
const persistence = new URL(location.href).searchParams.get('persistence') === '1'
const prediction = new URL(location.href).searchParams.get('prediction') === '1'
function fixtureGame(): Game | undefined { return (window as unknown as { __game?: Game }).__game }
function PredictionDiagnostics() {
  const [status, setStatus] = React.useState<ReturnType<Game['debugOnlinePrediction']>>(null)
  const [throttle, setThrottle] = React.useState(false)
  const [steering, setSteering] = React.useState(false)
  const [response, setResponse] = React.useState('No control sample yet')
  const sampleFrame = React.useRef<number | undefined>(undefined)
  const measure = (field: 'speed' | 'steer', apply: () => void) => {
    if (sampleFrame.current !== undefined) cancelAnimationFrame(sampleFrame.current)
    const before = fixtureGame()?.debugOnlinePrediction()?.[field], started = performance.now()
    apply()
    if (before === undefined) { setResponse('Start a race before measuring controls'); return }
    const sample = () => {
      const current = fixtureGame()?.debugOnlinePrediction()?.[field], elapsed = performance.now() - started
      if (current !== undefined && Math.abs(current - before) > .005) setResponse(`${field}: ${elapsed.toFixed(1)} ms to first changed rendered state`)
      else if (elapsed >= 1000) setResponse(`${field}: no rendered change observed within 1000 ms`)
      else sampleFrame.current = requestAnimationFrame(sample)
    }
    sampleFrame.current = requestAnimationFrame(sample)
  }
  React.useEffect(() => {
    const timer = setInterval(() => setStatus(fixtureGame()?.debugOnlinePrediction() ?? null), 250)
    return () => { clearInterval(timer); if (sampleFrame.current !== undefined) cancelAnimationFrame(sampleFrame.current); fixtureGame()?.debugInput({ throttle: 0, steer: 0 }) }
  }, [])
  return <div style={{ position: 'fixed', zIndex: 1100, left: 20, bottom: 120, maxWidth: 500, background: '#15202b', color: 'white', padding: 8 }}>
    <output aria-label="Prediction diagnostics">{JSON.stringify(status)}</output>
    <output aria-label="Control response sample">{response}</output>
    <button onClick={() => measure('speed', () => { fixtureGame()?.debugInput({ throttle: throttle ? 0 : 1 }); setThrottle(!throttle) })}>{throttle ? 'Release test throttle' : 'Apply test throttle'}</button>
    <button onClick={() => measure('steer', () => { fixtureGame()?.debugInput({ steer: steering ? 0 : 1 }); setSteering(!steering) })}>{steering ? 'Release test steering' : 'Apply test steering'}</button>
  </div>
}
const playerId = persistence ? resultPlayers[player === 'one' ? 0 : 1] : `smoke-${player}`
export function Fixture() {
  const connected = useStore(lobbyStore, s => s.status === 'connected' || s.status === 'reconnecting')
  const recovering = useStore(lobbyStore, s => s.status === 'reconnecting')
  const delayAuth = React.useRef(false)
  const saved = useStore(lobbyStore, s => s.snapshot?.resultPersistence?.state === 'saved')
  React.useEffect(() => {
    if (!persistence || !saved) return
    void fetch('http://127.0.0.1:2570/history', { headers: { Authorization: `Bearer smoke-${player}` } })
      .then(r => { if (!r.ok) throw new Error('Fixture history unavailable'); return r.json() })
      .then(data => {
        if (accountStore.getState().player?.id === playerId) raceHistoryStore.setState({ playerId, status: 'ready', rows: parseHistoryPage(data, playerId), hasMore: false, cursor: null, error: null })
      })
  }, [saved])
  const [code, setCode] = React.useState('')
  const join = (action: 'create' | 'join') => {
    accountStore.setState({ status: 'signedIn', player: { id: playerId, email: null, name: null, avatarUrl: null }, profile: { id: playerId, handle: `smoke_${player}`, display_name: `Smoke ${player}`, handle_changed_at: '2026-10-23T00:00:00Z' }, profileStatus: 'ready' })
    void enterLobby(action, code, 'porsche911', async () => {
      if (delayAuth.current) { delayAuth.current = false; await new Promise(resolve => setTimeout(resolve, 3000)) }
      return `smoke-${player}`
    })
  }
  return <><App />{prediction && <PredictionDiagnostics />}{connected && <div style={{ position: 'fixed', zIndex: 1000, left: 20, bottom: 75 }}>
    <button disabled={recovering} onClick={() => { delayAuth.current = true; window.dispatchEvent(new Event('offline')) }}>Drop test connection</button>
  </div>}{!connected && <div style={{ position: 'fixed', zIndex: 1000, left: 20, top: '45%', padding: 20, background: '#15202b', color: 'white' }}>
    <p>Local browser fixture: racer {player}</p><button onClick={() => join('create')}>Create test lobby</button>
    <input aria-label="Test room code" value={code} onChange={e => setCode(e.target.value)} /><button onClick={() => join('join')}>Join test lobby</button>
  </div>}</>
}
const root = createRoot(document.getElementById('root')!)
root.render(<Fixture />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
