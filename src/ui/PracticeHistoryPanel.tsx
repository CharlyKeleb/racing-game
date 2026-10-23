import { useEffect } from 'react'
import { useStore } from 'zustand'
import { raceHistoryStore } from '../stores/raceHistoryStore'
import { getCar } from '../vehicles/carRegistry'
import { useAccount } from './hooks'
import { useGameInstance } from './GameContext'
import { Button } from './kit'

const time = (ticks: number) => {
  const ms = Math.round(ticks * 1000 / 60)
  return `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}
export function PracticeHistoryPanel() {
  const game = useGameInstance()
  const playerId = useAccount(s => s.player?.id)
  const history = useStore(raceHistoryStore)
  useEffect(() => { if (playerId) void game?.loadPracticeHistory() }, [game, playerId])
  const own = history.playerId === playerId
  const rows = own ? history.rows : []
  const loading = !own || history.status === 'loading' || history.status === 'idle'
  return <section className="practice-history" aria-label="Online race history">
    <header><div><span className="eyebrow">Your time on track</span><h3>Online practice</h3></div>
      <Button size="sm" variant="secondary" disabled={loading || !game} onClick={() => void game?.loadPracticeHistory()}>Latest races</Button></header>
    <p className="racer-hint">Server-confirmed practice sessions. Offline records and competitive leaderboards are separate.</p>
    {loading && <p role="status">Loading your race history…</p>}
    {own && history.status === 'error' && <><p className="racer-error" role="alert">{history.error}</p><Button size="sm" onClick={() => void game?.loadPracticeHistory(rows.length > 0)}>Retry history</Button></>}
    {own && history.status === 'ready' && !rows.length && <p className="practice-history__empty">Your grid is waiting. Saved online races will appear here.</p>}
    {!!rows.length && <div className="practice-history__scroll"><table><caption>Saved online practice races</caption>
      <thead><tr><th scope="col">Race</th><th scope="col">Place</th><th scope="col">Time</th><th scope="col">Best lap</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.race_id}>
        <th scope="row"><time dateTime={r.recorded_at}>{new Date(r.recorded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</time>
          <span>Nürburgring GP · {r.laps} {r.laps === 1 ? 'lap' : 'laps'}</span><small>{getCar(r.car_id).name}</small></th>
        <td>{r.rank === null ? '—' : `P${r.rank}`}</td><td>{r.finish_ticks === null ? 'DNF' : time(r.finish_ticks)}</td>
        <td>{r.lap_ticks.length ? time(Math.min(...r.lap_ticks)) : '—'}</td>
      </tr>)}</tbody>
    </table></div>}
    {own && history.hasMore && <Button size="sm" variant="secondary" disabled={loading} onClick={() => void game?.loadPracticeHistory(true)}>Earlier races</Button>}
  </section>
}
