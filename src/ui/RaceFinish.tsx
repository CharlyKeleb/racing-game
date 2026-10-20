import { formatTime } from '../racing/LapTimer'
import { useGameInstance } from './GameContext'
import { useGame, useTelemetry } from './hooks'
import { Button } from './kit'

export function RaceFinish() {
  const game = useGameInstance()
  const drift = useGame(s => s.settings.mode === 'drift')
  const track = useGame(s => s.trackName)
  const place = useTelemetry(s => s.finishPosition)
  const field = useTelemetry(s => s.finishFieldSize)
  const progress = useTelemetry(s => s.finishProgress)
  const total = useTelemetry(s => s.totalMs)
  const score = useTelemetry(s => s.driftTotal)
  const victory = !drift && field > 1 && place === 1
  return <section className={`race-finish ${victory ? 'race-finish--victory' : ''}`} aria-label="Race finish cinematic">
    <div className="race-finish__letterbox race-finish__letterbox--top" />
    <div className="race-finish__line" />
    <div className="race-finish__copy" role="status">
      <span className="eyebrow">{track} / {drift ? 'Drift challenge' : 'Chequered flag'}</span>
      <h1>{drift ? 'DRIFT COMPLETE' : victory ? 'VICTORY' : field === 1 ? 'RUN COMPLETE' : 'FINISH'}</h1>
      <div className="race-finish__summary">
        {!drift && <strong>{field > 1 ? `P${place}` : 'SOLO'}<small>{field > 1 ? ` / ${field}` : ' RUN'}</small></strong>}
        {drift && <strong>{score.toLocaleString()}<small> PTS</small></strong>}
        <span>{formatTime(total)}<small>FINAL TIME</small></span>
      </div>
    </div>
    <Button className="race-finish__skip" variant="ghost" onClick={() => game?.skipRaceFinish()}>View results <kbd>Enter</kbd></Button>
    <div className="race-finish__letterbox race-finish__letterbox--bottom"><i style={{ transform: `scaleX(${progress})` }} /></div>
  </section>
}
