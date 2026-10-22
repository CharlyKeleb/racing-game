import { useEffect, useState } from 'react'
import type { Standing } from '../racing/RaceStandings'

/** How long the gain / loss flash and the ▲/▼ chip stay up (ms); matches the CSS. */
const FLASH_MS = 1400
/** Leaderboard row pitch (px); rows slide between slots, so it's fixed. Matches .hud-field li. */
const ROW_PX = 26

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return 'th'
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
}

/**
 * The player's race position, Need for Speed-style: a big slanted numeral that
 * rolls to the new place when it changes (up from below on a gain, down from
 * above on a loss), with a green or red sweep and a ▲/▼ chip for the places
 * won or lost.
 */
export function PositionBadge({ position, total }: { position: number; total: number }) {
  const [change, setChange] = useState<{ from: number; delta: number; key: number } | null>(null)
  // Previous-render value in state (React's "adjusting state on a prop change").
  const [last, setLast] = useState(position)
  if (last !== position) {
    setLast(position)
    setChange({ from: last, delta: last - position, key: (change?.key ?? 0) + 1 })
  }
  useEffect(() => {
    if (!change) return
    const timer = window.setTimeout(() => setChange(null), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [change])
  const dir = change ? (change.delta > 0 ? 'gain' : 'loss') : ''

  return (
    <div className={`hud-pos${dir ? ` hud-pos--${dir}` : ''}${position === 1 ? ' hud-pos--lead' : ''}`} aria-label={`Race position ${position} of ${total}`} key={change?.key}>
      <span className="eyebrow">Pos</span>
      <span className="hud-pos__roll">
        {change && <b className={`hud-pos__num hud-pos__num--out-${dir}`} aria-hidden="true">{change.from}</b>}
        <b className={`hud-pos__num${change ? ` hud-pos__num--in-${dir}` : ''}`}>{position}<sup>{ordinal(position)}</sup></b>
      </span>
      <span className="hud-lap__total">/{total}</span>
      {change && <span className={`hud-pos__chip hud-pos__chip--${dir}`} aria-hidden="true">{change.delta > 0 ? '▲' : '▼'} {Math.abs(change.delta)}</span>}
    </div>
  )
}

/**
 * Leaderboard whose rows slide to their new slots on an overtake. Rows render
 * in a fixed (id) order so React keeps each element and the CSS transform
 * transition animates the move; a row that just climbed flashes.
 */
export function Leaderboard({ standings }: { standings: Standing[] }) {
  const [last, setLast] = useState(standings)
  const [climbed, setClimbed] = useState<ReadonlySet<number>>(new Set())
  if (last !== standings) {
    setLast(standings)
    const before = new Map(last.map(s => [s.id, s.position]))
    const up = standings.filter(s => s.position < (before.get(s.id) ?? s.position)).map(s => s.id)
    if (up.length) setClimbed(new Set([...climbed, ...up]))
  }
  useEffect(() => {
    if (!climbed.size) return
    const timer = window.setTimeout(() => setClimbed(new Set()), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [climbed])
  const rows = [...standings].sort((a, b) => a.id - b.id)

  return (
    <ol className="hud-field" aria-label="Race leaderboard" style={{ height: standings.length * ROW_PX + 14 }}>
      {rows.map(s => (
        <li
          key={s.id}
          className={`${s.player ? 'hud-field__player' : ''}${climbed.has(s.id) ? ' hud-field__climb' : ''}`}
          style={{ transform: `translateY(${(s.position - 1) * ROW_PX}px)` }}
          aria-posinset={s.position}
        >
          <b>{s.position}</b>
          <span>{s.name.split(' · ')[0]}</span>
          <small className="mono">{s.position === 1 ? 'LEADER' : s.gapMs !== null ? `+${(s.gapMs / 1000).toFixed(2)}s` : s.gapLaps > 0 ? `+${s.gapLaps} LAP` : `+${Math.round(s.gapMeters)}m`}</small>
        </li>
      ))}
    </ol>
  )
}
