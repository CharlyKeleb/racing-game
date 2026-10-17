import { formatTime } from '../racing/LapTimer'
import { useGame, useTelemetry } from './hooks'

function gearLabel(gear: number): string {
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(gear)
}

export function Hud() {
  const t = useTelemetry((s) => s)
  const phase = useGame((s) => s.phase)
  const rpmT = Math.min(t.rpm / t.redlineRpm, 1)

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="stat">
          <span className="label">Lap</span>
          <span className="value">{Math.max(t.lap, 1)}/{t.totalLaps}</span>
        </div>
        <div className="stat">
          <span className="label">Time</span>
          <span className="value mono">{formatTime(t.currentLapMs)}</span>
        </div>
        <div className="stat">
          <span className="label">Best</span>
          <span className="value mono">{formatTime(t.bestLapMs)}</span>
        </div>
        <div className="stat fps">{t.fps} fps</div>
      </div>

      {phase === 'countdown' && t.countdown > 0 && <div className="countdown">{Math.ceil(t.countdown)}</div>}

      <div className="speedo">
        <div className="rpm-bar">
          <div className={`rpm-fill ${rpmT > 0.92 ? 'redline' : ''}`} style={{ width: `${rpmT * 100}%` }} />
        </div>
        <div className="speed-row">
          <span className="speed mono">{Math.round(t.speedKmh)}</span>
          <span className="unit">km/h</span>
          <span className="gear">{gearLabel(t.gear)}</span>
        </div>
      </div>
    </div>
  )
}
