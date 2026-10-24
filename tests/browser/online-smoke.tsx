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
if (!import.meta.env.DEV || import.meta.env.VITE_MULTIPLAYER_URL !== 'http://127.0.0.1:2569') throw new Error('This fixture only connects to its dedicated localhost test server')
const player = new URL(location.href).searchParams.get('player') === 'two' ? 'two' : 'one'
const persistence = new URL(location.href).searchParams.get('persistence') === '1'
const prediction = new URL(location.href).searchParams.get('prediction') === '1'
function fixtureGame(): Game | undefined { return (window as unknown as { __game?: Game }).__game }
function PredictionDiagnostics() {
  const [status, setStatus] = React.useState<ReturnType<Game['debugOnlinePrediction']>>(null)
  const [throttle, setThrottle] = React.useState(false)
  React.useEffect(() => {
    const timer = setInterval(() => setStatus(fixtureGame()?.debugOnlinePrediction() ?? null), 250)
    return () => { clearInterval(timer); fixtureGame()?.debugInput({ throttle: 0 }) }
  }, [])
  return <div style={{ position: 'fixed', zIndex: 1100, left: 20, bottom: 120, maxWidth: 500, background: '#15202b', color: 'white', padding: 8 }}>
    <output aria-label="Prediction diagnostics">{JSON.stringify(status)}</output>
    <button onClick={() => { fixtureGame()?.debugInput({ throttle: throttle ? 0 : 1 }); setThrottle(!throttle) }}>{throttle ? 'Release test throttle' : 'Apply test throttle'}</button>
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
