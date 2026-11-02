import { useEffect } from 'react'
import { formatGap, formatScore, sameQuery, type LeaderboardMode, type LeaderboardQuery } from '../cloud/leaderboardData'
import { useGameInstance } from './GameContext'
import { useAccount, useGame, useLeaderboard } from './hooks'

/** Results screen: where this run's event leaves the player on the global board. */
export function LeaderboardResult({ mode }: { mode: LeaderboardMode }) {
  const game = useGameInstance()
  const track = useGame((s) => s.settings.track)
  const event = useGame((s) => s.settings.driftEvent)
  const signedIn = useAccount((s) => s.status === 'signedIn' && !!s.profile)
  const signedOut = useAccount((s) => s.status === 'signedOut')
  const state = useLeaderboard()
  const query: LeaderboardQuery = { mode, track, event, car: null }
  useEffect(() => {
    if (signedIn) void game?.loadLeaderboard({ mode, track, event, car: null })
  }, [game, signedIn, mode, track, event])

  if (signedOut) return <p className="lb-result lb-result--hint">Sign in from the main menu to post this on the global leaderboard.</p>
  if (!signedIn || !sameQuery(state.query, query)) return null
  const rows = state.rows
  const me = rows.find((r) => r.is_me)
  if (state.status === 'loading') return <p className="lb-result lb-result--hint" role="status">Checking the global leaderboard…</p>
  if (!me) return null
  const rival = rows.find((r) => r.rank === me.rank - 1)
  return (
    <div className={`lb-result hub-mode--${mode}`} role="status">
      <span className="lb-result__rank">P{me.rank}<small>/ {me.entrants.toLocaleString()}</small></span>
      <span className="lb-result__text">
        <span className="eyebrow">Global leaderboard</span>
        {me.rank === 1 ? <b>{me.entrants === 1 ? 'First on the board.' : 'You lead the world.'}</b>
          : rival ? <b>{formatGap(mode, me.score, rival.score).slice(1)} behind {rival.display_name}</b>
          : <b>Your best: {formatScore(mode, me.score)}</b>}
      </span>
    </div>
  )
}
