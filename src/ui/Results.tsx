import { formatTime } from '../racing/LapTimer'
import { useGameInstance } from './GameContext'
import { useGame, useTelemetry } from './hooks'
import { Button, Panel } from './kit'

export function Results() {
  const drift = useGame(s => s.settings.mode === 'drift')
  const score = useTelemetry(s => s.driftTotal)
  const game = useGameInstance()
  const standings = useTelemetry((s) => s.standings)
  const total = useTelemetry((s) => s.totalMs)
  const best = useTelemetry((s) => s.bestLapMs)
  return (
    <div className="screen screen--center">
      <Panel title={drift ? 'Drift complete' : 'Finished'} className="results-panel">
        {drift && <div className="drift-result"><span className="eyebrow">Final score / Drift Challenge</span><strong>{score.toLocaleString()}</strong><span>POINTS BANKED</span><p>{score > 0 ? 'Keep linking those corners. Your next run starts here.' : 'Build speed, steer and tap Space to start a slide.'}</p></div>}
        <dl className="results">
          <dt>Total time</dt>
          <dd className="mono">{formatTime(total)}</dd>
          {!drift && <><dt>Best lap</dt><dd className="mono">{formatTime(best)}</dd></>}
        </dl>
        {standings.length > 1 && <ol className="race-standings" aria-label="Race standings">{standings.map(s => <li key={s.id} className={s.player ? 'race-standings__player' : ''}><b>{s.position}</b><span>{s.name}</span><span className="mono">{s.finishMs === null ? 'DNF' : formatTime(s.finishMs)}</span></li>)}</ol>}
        <Button variant="primary" size="lg" onClick={() => game?.startRace()} autoFocus>
          {drift ? 'Drift again' : 'Race again'}
        </Button>
        <Button variant="ghost" onClick={() => game?.quitToMenu()}>
          Main menu
        </Button>
      </Panel>
    </div>
  )
}
