import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { lobbyStore, leaveLobby } from '../multiplayer/LobbyClient'
import { onlineRaceStore } from '../multiplayer/onlineRaceStore'
import { startLightsLit } from '../racing/RaceManager'
import { isTouchDevice } from '../engine/device'
import { TouchControls } from './TouchControls'
import { Button, Panel } from './kit'

const touch = isTouchDevice()
export function OnlineRaceHud() {
  const state = useStore(onlineRaceStore)
  const roster = useStore(lobbyStore, s => s.snapshot?.racers)
  const race = useStore(lobbyStore, s => s.snapshot?.race)
  const ready = state.loaded && state.countdown === null
  const lights = state.countdown !== null ? startLightsLit(state.countdown) : 0
  return <div className="online-race" aria-label="Online practice">
    <header className="online-race__header">
      <div><span className="eyebrow">Private practice · Nürburgring GP</span><strong>Your crew. Same circuit.</strong><p>Ghost cars · Lap timing and results are coming next.</p></div>
      <Button size="sm" onClick={() => onlineRaceStore.setState({ menuOpen: true })}>Race menu <kbd>Esc</kbd></Button>
    </header>
    <aside className="online-race__roster" aria-label="Racers">{roster?.map(r => <div key={r.id}><strong>{r.displayName}</strong><span>@{r.handle}</span></div>)}</aside>
    {!state.loaded && <div className="online-race__message" role="status"><strong>{race ? 'Loading your grid…' : 'Returning to the lobby…'}</strong><span>Waiting for both racers to load the circuit.</span></div>}
    {state.loaded && state.countdown !== null && <div className="start-lights" role="img" aria-label={`${lights} of 5 start lights lit`}><div className="start-lights__gantry">{Array.from({ length: 5 }, (_, i) => <span key={i} className={`start-lights__pod${i < lights ? ' is-lit' : ''}`}><i /><i /></span>)}</div></div>}
    {state.delayed && <p className="online-race__delay" role="status">Connection delayed · Controls released</p>}
    <div className="online-race__gauges" aria-label={`${Math.round(state.speedKmh)} km/h, gear ${state.gear}`}>
      <span className="eyebrow">{Math.round(state.rpm)} rpm <b>{state.gear < 0 ? 'R' : state.gear}</b></span>
      <strong>{Math.round(state.speedKmh)}<small>km/h</small></strong>
      <label>N₂O <meter min={0} max={1} value={state.nitro} /></label>
    </div>
    {ready && !touch && <p className="online-race__keys">WASD drive · Space drift · Shift nitro · Hold B rear view</p>}
    {ready && touch && !state.menuOpen && <TouchControls online />}
    {state.menuOpen && <OnlineMenu />}
  </div>
}

function OnlineMenu() {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const close = () => onlineRaceStore.setState({ menuOpen: false })
  return <dialog ref={dialog} className="online-race__dialog" aria-label="Race menu" onClose={close} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() } }} onCancel={e => { e.preventDefault(); close() }}>
    <Panel title="Race menu" className="online-race__menu">
      <p>The race continues while this menu is open. Your driving controls are released.</p>
      <Button variant="primary" onClick={close} autoFocus>Return to driving</Button>
      <Button variant="ghost" onClick={() => void leaveLobby()}>Leave practice</Button>
    </Panel>
  </dialog>
}
