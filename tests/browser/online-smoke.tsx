// Explicit browser test fixture, outside the production build. No real account or token.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { useStore } from 'zustand'
import App from '../../src/App'
import '../../src/index.css'
import { accountStore } from '../../src/stores/accountStore'
import { lobbyStore, enterLobby } from '../../src/multiplayer/LobbyClient'
if (!import.meta.env.DEV || import.meta.env.VITE_MULTIPLAYER_URL !== 'http://127.0.0.1:2569') throw new Error('This fixture only connects to its dedicated localhost test server')
const player = new URL(location.href).searchParams.get('player') === 'two' ? 'two' : 'one'
export function Fixture() {
  const connected = useStore(lobbyStore, s => s.status === 'connected')
  const [code, setCode] = React.useState('')
  const join = (action: 'create' | 'join') => {
    accountStore.setState({ status: 'signedIn', player: { id: `smoke-${player}`, email: null, name: null, avatarUrl: null }, profile: { id: `smoke-${player}`, handle: `smoke_${player}`, display_name: `Smoke ${player}`, handle_changed_at: '2026-10-23T00:00:00Z' }, profileStatus: 'ready' })
    void enterLobby(action, code, 'porsche911', async () => `smoke-${player}`)
  }
  return <><App />{!connected && <div style={{ position: 'fixed', zIndex: 1000, left: 20, top: '45%', padding: 20, background: '#15202b', color: 'white' }}>
    <p>Local browser fixture: racer {player}</p><button onClick={() => join('create')}>Create test lobby</button>
    <input aria-label="Test room code" value={code} onChange={e => setCode(e.target.value)} /><button onClick={() => join('join')}>Join test lobby</button>
  </div>}</>
}
const root = createRoot(document.getElementById('root')!)
root.render(<Fixture />)
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount())
