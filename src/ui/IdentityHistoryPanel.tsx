import { useEffect } from 'react'
import { useStore } from 'zustand'
import { identityHistoryStore } from '../stores/identityHistoryStore'
import { useAccount } from './hooks'
import { useGameInstance } from './GameContext'
import { Button } from './kit'

export function IdentityHistoryPanel() {
  const game = useGameInstance()
  const playerId = useAccount(s => s.player?.id)
  const history = useStore(identityHistoryStore)
  useEffect(() => { if (playerId) void game?.loadIdentityHistory() }, [game, playerId])
  const own = !!playerId && history.playerId === playerId
  const rows = own ? history.rows : []
  const loading = !own || history.status === 'loading' || history.status === 'idle'
  return <section className="practice-history identity-history" aria-label="Private name history">
    <header><div><span className="eyebrow">The names behind the wheel</span><h3>Name history</h3></div>
      <Button size="sm" variant="secondary" disabled={loading || !game} onClick={() => void game?.loadIdentityHistory()}>Latest changes</Button></header>
    <p className="racer-hint">Only you can see this history. Earlier changes made before name tracking began may not appear.</p>
    {loading && <p role="status">Loading your name history…</p>}
    {own && history.status === 'error' && <><p className="racer-error" role="alert">{history.error}</p>
      <Button size="sm" disabled={!game} onClick={() => void game?.loadIdentityHistory(rows.length > 0)}>Retry name history</Button></>}
    {own && history.status === 'ready' && !rows.length && <p className="practice-history__empty">No saved name changes yet.</p>}
    {!!rows.length && <ol className="identity-history__events">{rows.map(row => <li key={row.event_id}>
      <div className="identity-history__event-header"><strong>{row.kind === 'renamed' ? 'Name changed' : row.kind === 'created' ? 'Racer created' : 'Name tracking began'}</strong>
        <time dateTime={row.recorded_at}>{new Date(row.recorded_at).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>
      <dl>{row.kind === 'renamed' && <><dt>Previously</dt><dd>{row.old_display_name} <span>@{row.old_handle}</span></dd></>}
        <dt>{row.kind === 'renamed' ? 'Changed to' : 'Recorded as'}</dt><dd>{row.new_display_name} <span>@{row.new_handle}</span></dd></dl>
    </li>)}</ol>}
    {own && history.hasMore && <Button size="sm" variant="secondary" disabled={loading || !game} onClick={() => void game?.loadIdentityHistory(true)}>Earlier names</Button>}
  </section>
}
