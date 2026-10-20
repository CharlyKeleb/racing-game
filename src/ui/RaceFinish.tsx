import { BADGE_AT, LABEL_AT, blackout } from '../racing/FinishSequence'
import { formatTime } from '../racing/LapTimer'
import { useGameInstance } from './GameContext'
import { useGame, useTelemetry } from './hooks'
import { ordinal } from './ordinal'

const smooth = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t) }

/**
 * Overlay for the finish cinematic (shots: FinishSequence / RaceFinishCamera).
 * Deliberately understated, like the reference: letterbox bars, the place
 * landing mid-slide with a ring swirl, then a small result label at the top
 * while the camera does the talking; a dip to black before the beauty shots.
 */
export function RaceFinish() {
  const game = useGameInstance()
  const drift = useGame(s => s.settings.mode === 'drift')
  const place = useTelemetry(s => s.finishPosition)
  const field = useTelemetry(s => s.finishFieldSize)
  const seconds = useTelemetry(s => s.finishSeconds)
  const reduced = useTelemetry(s => s.finishReduced)
  const total = useTelemetry(s => s.totalMs)
  const score = useTelemetry(s => s.driftTotal)
  const solo = field <= 1
  const topThree = place <= 3
  const t = reduced ? LABEL_AT + 1 : seconds
  const bars = reduced ? 1 : smooth((t - 0.12) / 0.45)
  const showBadge = !reduced && !drift && !solo && t >= BADGE_AT && t < LABEL_AT + 0.4
  const showLabel = t >= LABEL_AT
  const objective = drift ? 'DRIFT CHALLENGE' : solo ? 'SOLO RUN' : 'FINISH TOP 3'
  const passed = drift || solo || topThree
  return <section className="race-finish" aria-label="Race finish cinematic">
    <div className="race-finish__bar race-finish__bar--top" style={{ transform: `scaleY(${bars})` }} />
    <div className="race-finish__bar race-finish__bar--bottom" style={{ transform: `scaleY(${bars})` }}>
      <button type="button" className="race-finish__skip" onClick={() => game?.skipRaceFinish()}>Skip <kbd>Enter</kbd></button>
    </div>
    {showBadge && <div className={`race-finish__badge ${t >= LABEL_AT ? 'is-leaving' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 120 120" className="race-finish__swirl">
        <circle cx="60" cy="60" r="50" pathLength="100" />
        <circle cx="60" cy="60" r="41" pathLength="100" />
      </svg>
      <b>{ordinal(place)}</b>
    </div>}
    {showLabel && <div className="race-finish__label" role="status">
      <span className="race-finish__objective">{objective}<i className={passed ? 'is-done' : 'is-missed'}>{passed ? '✓' : '✕'}</i></span>
      <span className="race-finish__result">
        {drift ? <><b>{score.toLocaleString()}</b> PTS</> : <>{!solo && <b>{ordinal(place)}</b>}{formatTime(total)}</>}
      </span>
    </div>}
    <div className="race-finish__black" style={{ opacity: reduced ? 0 : blackout(t) }} />
  </section>
}
