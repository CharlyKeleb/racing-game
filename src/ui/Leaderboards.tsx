import { useEffect, useState } from 'react'
import { GiPodium } from 'react-icons/gi'
import { buildClass, formatGap, formatScore, sameQuery, type LeaderboardMode, type LeaderboardQuery, type LeaderboardRow } from '../cloud/leaderboardData'
import { DRIFT_EVENTS, type DriftEventId } from '../racing/driftEvents'
import { CARS } from '../vehicles/carRegistry'
import { TRACKS } from '../world/tracks'
import { useGameInstance } from './GameContext'
import { useAccount, useGame, useLeaderboard } from './hooks'
import { Button, Chevron, ClassBadge } from './kit'
import trackPreviews from './trackPreviews.json'

const SKELETON_ROWS = 6

function Options<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick(v: T): void }) {
  return (
    <div className="ui-segmented lb-options" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} role="radio" aria-checked={id === value} className={id === value ? 'on' : ''} onClick={() => onPick(id)}><span>{text}</span></button>
      ))}
    </div>
  )
}

function Row({ row, mode, leader }: { row: LeaderboardRow; mode: LeaderboardMode; leader: number }) {
  const car = CARS.find((c) => c.id === row.car_id)?.name
  const cls = buildClass(row.car_id, row.build_key)
  return (
    <li className={`lb-row${row.rank <= 3 ? ` lb-row--p${row.rank}` : ''}${row.is_me ? ' lb-row--me' : ''}`} aria-current={row.is_me ? 'true' : undefined}>
      <span className="lb-row__rank">{row.rank}</span>
      <span className="lb-row__who">
        <b>{row.display_name}{row.is_me && <i>You</i>}</b>
        {car && <small>{car}</small>}
      </span>
      {cls && <ClassBadge value={cls} />}
      <span className="lb-row__score">
        <b>{formatScore(mode, row.score)}</b>
        <small>{row.rank === 1 ? (mode === 'drift' ? 'Top score' : 'Fastest') : formatGap(mode, row.score, leader)}</small>
      </span>
    </li>
  )
}

/** The Leaderboards tab: one global board at a time, opening on the event the player has set up. */
export function Leaderboards({ onAccount, onDrive }: { onAccount(): void; onDrive(): void }) {
  const game = useGameInstance()
  const settings = useGame((s) => s.settings)
  const update = useGame((s) => s.updateSettings)
  const account = useAccount((s) => s.status)
  const hasProfile = useAccount((s) => !!s.profile)
  const needsRacer = useAccount((s) => s.status === 'signedIn' && s.profileStatus === 'ready' && !s.profile)
  const [mode, setMode] = useState<LeaderboardMode>(settings.mode === 'drift' ? 'drift' : 'timeTrial')
  const [trackIndex, setTrackIndex] = useState(() => Math.max(0, TRACKS.findIndex((t) => t.id === settings.track)))
  const [event, setEvent] = useState<DriftEventId>(settings.driftEvent)
  const [scope, setScope] = useState<'all' | 'car'>('all')
  const track = TRACKS[trackIndex]
  const query: LeaderboardQuery = { mode, track: track.id, event, car: mode === 'timeTrial' && scope === 'car' ? settings.car : null }
  const { car } = query
  const state = useLeaderboard()
  // The store may still hold another board for a moment: never show it under this title.
  const current = sameQuery(state.query, query)
  const rows = current ? state.rows : []
  const status = current ? state.status : 'loading'
  const leader = rows.find((r) => r.rank === 1)?.score ?? 0
  const me = rows.find((r) => r.is_me)
  const stepTrack = (by: number) => setTrackIndex((i) => (i + by + TRACKS.length) % TRACKS.length)
  const refresh = () => { void game?.loadLeaderboard(query) }

  useEffect(() => { void game?.loadLeaderboard({ mode, track: track.id, event, car }) }, [game, mode, track.id, event, car])

  const noun = mode === 'drift' ? 'score' : 'lap'
  return (
    <div className={`lb hub-mode--${mode}`}>
      <header className="lb__head">
        <span className="hub-eyebrow"><GiPodium aria-hidden="true" /> Global leaderboard</span>
        <div className="lb__circuit">
          <Chevron dir="left" label="Previous circuit" onClick={() => stepTrack(-1)} />
          <h2>{track.name}<small>{trackPreviews[track.id as keyof typeof trackPreviews]?.lengthKm} km</small></h2>
          <Chevron dir="right" label="Next circuit" onClick={() => stepTrack(1)} />
        </div>
        <Options<LeaderboardMode> label="Event type" value={mode} onPick={setMode} options={[['timeTrial', 'Time Trial'], ['drift', 'Drift']]} />
        {mode === 'timeTrial'
          ? <Options<'all' | 'car'> label="Cars" value={scope} onPick={setScope} options={[['all', 'All cars'], ['car', CARS.find((c) => c.id === settings.car)?.name ?? 'This car']]} />
          : <Options<DriftEventId> label="Drift event" value={event} onPick={setEvent} options={Object.values(DRIFT_EVENTS).map((e) => [e.id, e.name])} />}
      </header>

      <div className="lb__body" aria-busy={status === 'loading'}>
        {status === 'loading' && !rows.length && <div role="status" aria-label="Loading the leaderboard">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <div key={i} className="lb-skeleton" aria-hidden="true" />)}
        </div>}
        {status === 'offline' && <p className="lb__note">Leaderboards aren't available in this build. Your personal bests still save on this device.</p>}
        {status === 'error' && !rows.length && <div className="lb__note" role="alert">
          <p>Couldn't reach the leaderboard. Your times are safe and will post later.</p>
          <Button size="sm" onClick={refresh}>Try again</Button>
        </div>}
        {status === 'ready' && !rows.length && <div className="lb__note">
          <strong>No {noun}s on the board yet</strong>
          <p>{car ? 'Nobody has posted one in this car.' : `Post the first ${noun} on ${track.name}.`}</p>
        </div>}
        {!!rows.length && <ol className="lb__list" aria-label={`${track.name} leaderboard`}>
          {rows.map((row) => <Row key={row.rank} row={row} mode={mode} leader={leader} />)}
        </ol>}
      </div>

      <footer className="lb__foot">
        <div className="lb__you" role="status">
          {account === 'signedOut' && <span>Sign in to put your {noun}s on the board.</span>}
          {needsRacer && <span>Create your racer to post {noun}s under your name.</span>}
          {hasProfile && me && <span><b>P{me.rank}</b> of {me.entrants.toLocaleString()}</span>}
          {hasProfile && !me && status === 'ready' && <span>Your best {noun}s post here under your racer name.</span>}
        </div>
        <div className="lb__actions">
          {account === 'signedOut' && <Button size="sm" variant="secondary" onClick={onAccount}>Sign in</Button>}
          {needsRacer && <Button size="sm" variant="secondary" onClick={onAccount}>Create racer</Button>}
          <Button size="sm" variant="primary" onClick={() => {
            update({ mode, track: track.id, ...(mode === 'drift' ? { driftEvent: event } : {}) })
            onDrive()
          }}>{mode === 'drift' ? 'Drift here' : 'Set a lap'}</Button>
        </div>
      </footer>
    </div>
  )
}
