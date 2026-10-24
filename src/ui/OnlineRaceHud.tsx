import { ConnectionStatus } from './ConnectionStatus'
import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { lobbyStore, leaveLobby, returnToLobby, setRematchReady } from '../multiplayer/LobbyClient'
import { onlineRaceStore } from '../multiplayer/onlineRaceStore'
import type { RaceResult, ResultPersistence } from '../../server/src/protocol'
import { startLightsLit } from '../racing/RaceManager'
import { isTouchDevice } from '../engine/device'
import { TouchControls } from './TouchControls'
import { Button, Panel } from './kit'

const touch = isTouchDevice()
export function OnlineRaceHud() {
  const state = useStore(onlineRaceStore)
  const recovering = useStore(lobbyStore, s => s.status === 'reconnecting')
  const lobby = useStore(lobbyStore, s => s.snapshot)
  const sessionId = useStore(lobbyStore, s => s.sessionId)
  const frame = useStore(lobbyStore, s => s.raceSnapshot)
  const roster = (lobby?.raceRacers ?? lobby?.racers)?.map(r => ({ ...r, connected: lobby?.racers.find(current => current.id === r.id)?.connected ?? false }))
  const race = lobby?.race
  const self = roster?.find(r => r.sessionId === sessionId)
  const progress = frame?.progress?.find(p => p.id === self?.id)
  const result = frame?.result
  const ready = state.loaded && state.countdown === null && !state.finished && !recovering
  const lights = state.countdown !== null ? startLightsLit(state.countdown) : 0
  return <div className="online-race" aria-label="Online practice">
    <header className="online-race__header">
      <div><span className="eyebrow">Private practice · Nürburgring GP</span><strong>Your crew. Same circuit.</strong><p>Ghost cars · Server timing · Session results</p><ConnectionStatus /></div>
      <Button size="sm" onClick={() => onlineRaceStore.setState({ menuOpen: true })}>Race menu <kbd>Esc</kbd></Button>
    </header>
    <aside className="online-race__roster" aria-label="Racers">{roster?.map(r => {
      const p = frame?.progress?.find(p => p.id === r.id)
      const label = p?.retiredTicks !== undefined ? 'DNF' : r.connected === false ? 'Reconnecting…' : p?.finishTicks != null ? 'Finished' : `Lap ${Math.min((p?.completedLaps ?? 0) + 1, lobby?.laps ?? 1)} / ${lobby?.laps ?? 1}`
      return <div key={r.id}><strong>{r.displayName}</strong><span>@{r.handle} · {label}</span></div>
    })}</aside>
    {!state.loaded && <div className="online-race__message" role="status"><strong>{race ? 'Loading your grid…' : 'Returning to the lobby…'}</strong><span>Waiting for both racers to load the circuit.</span></div>}
    {state.loaded && state.countdown !== null && <div className="start-lights" role="img" aria-label={`${lights} of 5 start lights lit`}><div className="start-lights__gantry">{Array.from({ length: 5 }, (_, i) => <span key={i} className={`start-lights__pod${i < lights ? ' is-lit' : ''}`}><i /><i /></span>)}</div></div>}
    {progress && !result && <div className="online-race__timing" aria-label="Race timing">
      <strong>{progress.finishTicks !== null ? 'Finished · Waiting for your rival' : `Lap ${Math.min(progress.completedLaps + 1, lobby?.laps ?? 1)} / ${lobby?.laps ?? 1}`}</strong>
      <span>{formatTicks(progress.finishTicks ?? Math.max(0, (frame?.tick ?? 0) - (race?.countdownTicks ?? 180)))}</span>
      <small>{progress.finishTicks !== null ? 'Your rival has up to 60 seconds to finish.' : `Next gate ${progress.nextCheckpoint === 0 ? 'Finish' : progress.nextCheckpoint}`}</small>
    </div>}
    {(state.delayed || recovering || lobby?.draining) && !result && <p className="online-race__delay" role="status">{recovering ? 'Reconnecting · Your race continues · Controls released' : state.delayed ? 'Connection delayed · Controls released' : 'Server restarting · Finish before the shutdown window closes'}</p>}
    <div className="online-race__gauges" aria-label={`${Math.round(state.speedKmh)} km/h, gear ${state.gear}`}>
      <span className="eyebrow">{Math.round(state.rpm)} rpm <b>{state.gear < 0 ? 'R' : state.gear}</b></span>
      <strong>{Math.round(state.speedKmh)}<small>km/h</small></strong>
      <label>N₂O <meter min={0} max={1} value={state.nitro} /></label>
    </div>
    {ready && !touch && <p className="online-race__keys">WASD drive · Space drift · Shift nitro · Hold B rear view</p>}
    {ready && touch && !state.menuOpen && <TouchControls online />}
    {state.menuOpen && !result && <OnlineMenu />}
    {result && <OnlineResults result={result} recovering={recovering} persistence={lobby?.resultPersistence?.raceId === result.raceId ? lobby.resultPersistence : undefined} host={self?.id === lobby?.hostId} names={new Map(roster?.map(r => [r.id, r.displayName]))} />}
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

function formatTicks(ticks: number): string {
  const ms = Math.round(ticks * 1000 / 60)
  return `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}

function OnlineResults({ result, persistence, host, names, recovering }: { recovering: boolean; result: RaceResult; persistence?: ResultPersistence; host: boolean; names: Map<string, string> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const lobby = useStore(lobbyStore, s => s.snapshot)
  const sessionId = useStore(lobbyStore, s => s.sessionId)
  const self = lobby?.racers.find(r => r.sessionId === sessionId)
  const canRematch = lobby?.rematchEnabled === true && !recovering && lobby?.racers.length === 2 && lobby.raceRacers?.length === 2
    && lobby.raceRacers.every(r => lobby.racers.some(current => current.id === r.id && current.connected !== false))
  const voted = !!self && !!lobby?.rematchVotes?.includes(self.id)
  const ranked = [...result.racers].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
  return <dialog ref={dialog} className="online-race__dialog online-race__results" aria-label="Practice results" onCancel={e => e.preventDefault()}>
    <Panel title="Practice results">
      <p>Server-confirmed · {result.laps} {result.laps === 1 ? 'lap' : 'laps'} · Nürburgring GP</p>
      <table><thead><tr><th scope="col">Place</th><th scope="col">Racer</th><th scope="col">Time</th><th scope="col">Best lap</th></tr></thead>
        <tbody>{ranked.map(r => <tr key={r.id}><td>{r.rank ?? '—'}</td><th scope="row">{names.get(r.id) ?? 'Racer'}</th><td>{r.finishTicks === null ? 'DNF' : formatTicks(r.finishTicks)}</td><td>{r.lapTicks.length ? formatTicks(Math.min(...r.lapTicks)) : '—'}</td></tr>)}</tbody>
      </table>
      <p>{result.reason === 'all-resolved' ? 'Every racer has finished or retired.' : result.reason === 'time-limit' ? 'The 10-minute practice limit was reached.' : result.reason === 'finish-window' ? 'The 60-second finish window ended.' : 'Everyone crossed the finish line.'}</p>
      {recovering && <p role="status">Reconnecting to your crew…</p>}
      <p role="status">{persistence?.state === 'saved' ? 'Saved to your profile as online practice.' : persistence?.state === 'saving' ? 'Saving your practice result…' : persistence?.state === 'pending' ? 'Save pending · The server has kept your result and will retry.' : persistence?.state === 'failed' ? 'This result could not be saved. It is still shown here for this session.' : 'These session results are not saved to your profile.'}</p>
      {canRematch && <><Button variant="primary" onClick={() => setRematchReady(!voted)}>{voted ? 'Cancel rematch vote' : 'Race again'}</Button>
        <p role="status">{voted ? 'Waiting for your rival. Votes expire after 60 seconds.' : lobby?.rematchVotes?.length ? 'Your rival wants a rematch. Race again with the same cars and laps.' : 'Both racers must agree to race again with the same cars and laps.'}</p></>}
      {host ? <Button variant="primary" onClick={returnToLobby} disabled={recovering} autoFocus>Return crew to lobby</Button> : <p role="status">Waiting for the host to return the crew to the lobby.</p>}
      <Button variant="ghost" onClick={() => void leaveLobby()} autoFocus={!host}>Leave practice</Button>
    </Panel>
  </dialog>
}
