import { ConnectionStatus } from './ConnectionStatus'
import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import { GiCheckeredFlag } from 'react-icons/gi'
import { enterLobby, leaveLobby, lobbyStore, multiplayerConfigured, setLobbyCar, setLobbyLaps, setLobbyReady, startLobbyRace } from '../multiplayer/LobbyClient'
import { isLobbyCar, LOBBY_CARS } from '../../server/src/protocol'
import { getCar } from '../vehicles/carRegistry'
import { useAccount, useGame } from './hooks'
import { useGameInstance } from './GameContext'
import { Button, Panel } from './kit'

export function OnlineLobby({ onClose, onAccount }: { onClose(): void; onAccount(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const game = useGameInstance()
  const account = useAccount((s) => s)
  const selectedCar = useGame((s) => s.settings.car)
  const preparing = useGame(s => s.carSwitching || s.trackSwitching)
  const { status, snapshot, sessionId, error } = useStore(lobbyStore)
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])
  const self = snapshot?.racers.find((r) => r.sessionId === sessionId)
  const host = self && snapshot?.hostId === self.id
  const busy = status === 'connecting' || status === 'reconnecting'
  const connected = status === 'connected' || status === 'reconnecting'
  const canLaunch = !snapshot?.draining && !busy && !preparing && !!host && snapshot?.racers.length === 2 && snapshot.racers.every(r => r.ready && r.connected !== false)
  const enter = (action: 'create' | 'join') => {
    if (game) void enterLobby(action, code, isLobbyCar(selectedCar) ? selectedCar : 'porsche911', () => game.multiplayerToken())
  }
  return <dialog ref={dialog} className="race-setup online-dialog" aria-labelledby="online-title" onCancel={(e) => { if (busy) e.preventDefault() }}
    onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget && !busy) dialog.current?.close() }}>
    <Panel>
      <header className="account-dialog__header"><div><span className="eyebrow">Online / Private lobby</span><h2 id="online-title" className="ui-panel__title">{connected ? 'Your crew. Your grid.' : 'Bring your rivals.'}</h2></div>
        <button className="racer-close" aria-label="Close online lobby" disabled={busy} onClick={() => dialog.current?.close()}>×</button></header>
      <p className="racer-hint">{snapshot?.raceEnabled ? 'Private practice · Two racers · Stock cars' : 'Lobby preview · Networked racing is coming next.'}</p>
      <ConnectionStatus />
      {!connected ? <>
        <div className="online-intro"><GiCheckeredFlag aria-hidden /><p>A private grid for you and your rivals.<br /><span>Create a room, share the code, get everyone ready.</span></p></div>
        {account.status !== 'signedIn' || !account.profile ? <>
          <p className="race-setup__note">{account.status === 'signedIn' ? 'Finish your racer profile to join your friends.' : 'Sign in and create your racer to join a private lobby.'}</p>
          <Button variant="primary" onClick={onAccount}>{account.status === 'signedIn' ? 'Create your racer' : 'Sign in'}</Button>
        </> : !multiplayerConfigured ? <p className="online-empty">Private lobbies are being prepared. Check back soon.</p> : <>
          <Button variant="primary" disabled={busy || !game} onClick={() => enter('create')}>{busy ? 'Connecting…' : 'Create private room'}</Button>
          <div className="online-divider"><span>or join your friends</span></div>
          <form className="online-join" onSubmit={(e) => { e.preventDefault(); enter('join') }}>
            <label className="ui-field"><span className="ui-field__label">Room code</span><input className="ui-input online-code-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="XXXXXXXX" aria-describedby="room-code-help" maxLength={8} required disabled={busy}
              value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ''))} /></label>
            <Button type="submit" disabled={busy || code.length !== 8 || !game}>Join room</Button>
            <p id="room-code-help" className="racer-hint">Ask the host for their 8-character code.</p>
          </form>
        </>}
      </> : snapshot ? <>
        <div className="online-room-code"><div><span className="eyebrow">Invite your rivals</span><strong>{snapshot.code}</strong></div><Button size="sm" onClick={() => {
          void navigator.clipboard.writeText(snapshot.code).then(() => setCopied(true)).catch(() => setCopied(false))
        }}>{copied ? 'Copied' : 'Copy code'}</Button></div>
        <div className="online-settings"><span>Nürburgring GP <small>Ghost collisions</small></span><label>Laps <select className="ui-input" aria-label="Lobby laps" disabled={!host || busy} value={snapshot.laps} onChange={(e) => setLobbyLaps(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}</select></label></div>
        <div className="online-roster" aria-label="Racers">
          {snapshot.racers.map((r) => <article className="online-racer" key={r.sessionId}>
            <span className="online-racer__initial" aria-hidden>{[...r.displayName][0]}</span>
            <div><strong>{r.displayName} {r.id === snapshot.hostId && <small>Host</small>}{r.sessionId === sessionId && <small>You</small>}</strong><span>@{r.handle} · {getCar(r.carId).name}</span></div>
            <span className={`online-ready ${r.ready ? 'on' : ''}`}>{r.connected === false ? 'Reconnecting…' : r.ready ? 'Ready' : 'Not ready'}</span>
          </article>)}
          {Array.from({ length: snapshot.maxPlayers - snapshot.racers.length }, (_, i) => <div className="online-empty" key={i}>Waiting for a rival…</div>)}
        </div>
        {self && <label className="ui-field"><span className="ui-field__label">Your car · Stock builds</span><select className="ui-input" disabled={busy} value={self.carId} onChange={(e) => { if (isLobbyCar(e.target.value)) setLobbyCar(e.target.value) }}>{LOBBY_CARS.map((id) => <option key={id} value={id}>{getCar(id).name}</option>)}</select></label>}
        <Button variant={self?.ready ? 'secondary' : 'primary'} disabled={preparing || busy} onClick={() => { game?.unlockAudio(); setLobbyReady(!self?.ready) }}>{self?.ready ? 'Cancel ready' : 'Ready up'}</Button>
        {snapshot.raceEnabled && host && <Button variant="primary" disabled={!canLaunch} onClick={() => { game?.unlockAudio(); startLobbyRace() }}>Launch practice</Button>}
        <p className="racer-hint" role="status">{snapshot.raceEnabled ? snapshot.racers.length !== 2 ? 'Practice needs exactly two racers.' : canLaunch ? 'Both racers are ready. Launch when you are.' : snapshot.racers.every(r => r.ready && r.connected !== false) ? 'Waiting for the host to launch practice.' : 'Waiting for both racers to ready up.' : snapshot.racers.length < 2 ? 'Share the code to invite another racer.' : snapshot.racers.every((r) => r.ready) ? 'Everyone is ready. Race launches arrive in the next milestone.' : 'Waiting for everyone to ready up.'}</p>
        <Button variant="ghost" onClick={() => void leaveLobby()}>Leave lobby</Button>
      </> : <p role="status">Loading the grid…</p>}
      {snapshot?.draining && <p role="status">The server is restarting. New races are paused; create a new lobby shortly.</p>}
      {status === 'reconnecting' && <p role="status">Reconnecting to your crew… Your seat is held for up to 15 seconds.</p>}
      {error && <p className="racer-error" role="alert">{error}</p>}
      {connected && <p className="racer-hint">You can close this panel and return to your lobby. Leaving the page ends your seat.</p>}
    </Panel>
  </dialog>
}
