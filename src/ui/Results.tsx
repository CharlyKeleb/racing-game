import { formatTime } from '../racing/LapTimer'
import { useGameInstance } from './GameContext'
import { useTelemetry } from './hooks'

export function Results() {
  const game = useGameInstance()
  const total = useTelemetry((s) => s.totalMs)
  const best = useTelemetry((s) => s.bestLapMs)
  return (
    <div className="panel menu">
      <h2>Finished</h2>
      <dl className="results">
        <dt>Total</dt>
        <dd className="mono">{formatTime(total)}</dd>
        <dt>Best lap</dt>
        <dd className="mono">{formatTime(best)}</dd>
      </dl>
      <button className="primary" onClick={() => game?.startRace()} autoFocus>
        Race again
      </button>
      <button onClick={() => game?.quitToMenu()}>Main menu</button>
    </div>
  )
}
