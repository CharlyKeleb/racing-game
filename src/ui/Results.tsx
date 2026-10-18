import { formatTime } from '../racing/LapTimer'
import { useGameInstance } from './GameContext'
import { useTelemetry } from './hooks'
import { Button, Panel } from './kit'

export function Results() {
  const game = useGameInstance()
  const standings = useTelemetry((s) => s.standings)
  const total = useTelemetry((s) => s.totalMs)
  const best = useTelemetry((s) => s.bestLapMs)
  return (
    <div className="screen screen--center">
      <Panel title="Finished" className="results-panel">
        <dl className="results">
          <dt>Total time</dt>
          <dd className="mono">{formatTime(total)}</dd>
          <dt>Best lap</dt>
          <dd className="mono">{formatTime(best)}</dd>
        </dl>
        {standings.length > 1 && <ol className="race-standings" aria-label="Race standings">{standings.map(s => <li key={s.id} className={s.player ? 'race-standings__player' : ''}><b>{s.position}</b><span>{s.name}</span><span className="mono">{s.finishMs === null ? 'DNF' : formatTime(s.finishMs)}</span></li>)}</ol>}
        <Button variant="primary" size="lg" onClick={() => game?.startRace()} autoFocus>
          Race again
        </Button>
        <Button variant="ghost" onClick={() => game?.quitToMenu()}>
          Main menu
        </Button>
      </Panel>
    </div>
  )
}
