import { ConnectionStatus } from './ConnectionStatus'
import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { lobbyStore, leaveLobby, returnToLobby, setRematchReady } from '../multiplayer/LobbyClient'
import { onlineRaceStore } from '../multiplayer/onlineRaceStore'
import { telemetryStore } from '../stores/telemetryStore'
import { RESET_VERSION, type RaceResult, type ResultPersistence } from '../../server/src/protocol'
import { startLightsLit } from '../racing/RaceManager'
import { isTouchDevice } from '../engine/device'
import { TouchControls } from './TouchControls'
import { Button, Panel } from './kit'
import { formatTime } from '../racing/LapTimer'
import { Minimap } from './Minimap'
import { Leaderboard, PositionBadge } from './RacePosition'
import { NitroGauge, RpmGauge, Speedometer } from './Speedometer'

const touch = isTouchDevice()
/** Dial full scale, as offline. */
const DIAL_MAX_KMH = 340

/** The offline race HUD (position, lap times, leaderboard, minimap, gantry, gauges) on server timing. */
export function OnlineRaceHud() {
  const state = useStore(onlineRaceStore)
  const recovering = useStore(lobbyStore, s => s.status === 'reconnecting')
  const lobby = useStore(lobbyStore, s => s.snapshot)
  const sessionId = useStore(lobbyStore, s => s.sessionId)
  const frame = useStore(lobbyStore, s => s.raceSnapshot)
  const roster = (lobby?.raceRacers ?? lobby?.racers)?.map(r => ({ ...r, connected: lobby?.racers.find(current => current.id === r.id)?.connected ?? false }))
  const race = lobby?.race
  const self = roster?.find(r => r.sessionId === sessionId)
  const result = frame?.result
  const ready = state.loaded && state.countdown === null && !state.finished && !recovering
  const lights = state.countdown !== null ? startLightsLit(state.countdown) : 0
  const player = state.standings.find(s => s.player)
  const notices = roster?.filter(r => r.id !== self?.id).map(r => {
    const p = frame?.progress?.find(p => p.id === r.id)
    return p?.retiredTicks !== undefined ? `${r.displayName} · DNF` : r.connected === false ? `${r.displayName} · Reconnecting…` : null
  }).filter(Boolean)
  const missed = useStore(telemetryStore, s => s.missedCheckpoint)
  const canReset = race?.resetVersion === RESET_VERSION
  const shift = state.gear > 0 && state.rpm >= state.redlineRpm * .94
  const sweep = state.countdown !== null
  return <div className={`hud online-race${state.nitroActive ? ' hud--nitro' : ''}`} aria-label="Online practice">
    {state.loaded && <>
      <div className="hud-tl">
        {state.standings.length > 1 && player && <PositionBadge position={player.position} total={state.standings.length} />}
        <div className="hud-lap">
          <span className="eyebrow">Lap</span>
          <b>{state.lap}</b>
          <span className="hud-lap__total">/{state.totalLaps}</span>
        </div>
        <div className="hud-times">
          <div><span className="eyebrow">Time</span><span className="mono">{formatTime(state.currentLapMs)}</span></div>
          <div><span className="eyebrow">Best</span><span className="mono">{formatTime(state.bestLapMs)}</span></div>
        </div>
      </div>
      <div className="hud-tr">
        {state.standings.length > 1 && <Leaderboard standings={state.standings} />}
        {notices?.map(text => <p key={text} className="online-race__notice">{text}</p>)}
      </div>
      <div className="hud-bl">
        <div className="online-race__bar">
          <span className="eyebrow">Private practice</span>
          <ConnectionStatus />
          <Button size="sm" onClick={() => onlineRaceStore.setState({ menuOpen: true })}>Race menu <kbd>Esc</kbd></Button>
        </div>
        <Minimap />
      </div>
    </>}
    {!state.loaded && <div className="online-race__message" role="status"><strong>{race ? 'Loading your grid…' : 'Returning to the lobby…'}</strong><span>Waiting for both racers to load the circuit.</span></div>}
    {state.loaded && (state.countdown !== null || state.go) && <div className={`start-lights${state.go ? ' start-lights--go' : ''}`} role="img" aria-label={state.go ? 'Go' : `${lights} of 5 start lights lit`}>
      <div className="start-lights__gantry">{Array.from({ length: 5 }, (_, i) => <span key={i} className={`start-lights__pod${!state.go && i < lights ? ' is-lit' : ''}`}><i /><i /></span>)}</div>
      {state.go && <div className="start-lights__go">Go</div>}
    </div>}
    {ready && missed && <div className="hud-wrongway hud-wrongway--missed" role="alert">Missed checkpoint<small>{canReset ? touch ? 'Tap ↺ to go back' : 'Press R to go back' : 'Turn back and drive through it · laps only count through every gate'}</small></div>}
    {ready && state.finishWindowMs !== null && <p className="online-race__delay" role="status">Your rival has finished · {Math.ceil(state.finishWindowMs / 1000)} s left to cross the line</p>}
    {state.finished && !result && <div className="online-race__message" role="status"><strong>Finished</strong><span>Waiting for your rival · They have up to 60 seconds to finish.</span></div>}
    {(state.delayed || recovering || lobby?.draining) && !result && <p className="online-race__delay" role="status">{recovering ? 'Reconnecting · Your race continues · Controls released' : state.delayed ? 'Connection delayed · Controls released' : 'Server restarting · Finish before the shutdown window closes'}</p>}
    {state.loaded && <div className="speedo">
      <div className="speedo__side">
        <RpmGauge rpm={state.rpm} redlineRpm={state.redlineRpm} shift={shift} sweep={sweep} />
        <NitroGauge level={state.nitro} active={state.nitroActive} ready={state.nitro > .1} cue={0} windowOpen={false} perfect={false} sweep={sweep} />
      </div>
      <Speedometer speedKmh={state.speedKmh} maxKmh={DIAL_MAX_KMH} gear={state.gear < 0 ? 'R' : state.gear === 0 ? 'N' : String(state.gear)} shift={shift} nitro={state.nitroActive} sweep={sweep} />
    </div>}
    {ready && touch && !state.menuOpen && <TouchControls online onlineReset={canReset} />}
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
