import { formatTime } from '../racing/LapTimer'
import { useGame, useTelemetry } from './hooks'
import { Meter } from './kit'

const RPM_SEGMENTS = 24

function gearLabel(gear: number): string {
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(gear)
}

export function Hud() {
  const t = useTelemetry((s) => s)
  const phase = useGame((s) => s.phase)
  const rpmT = Math.min(t.rpm / t.redlineRpm, 1)
  const lit = Math.round(rpmT * RPM_SEGMENTS)

  return (
    <div className={t.nitroActive ? 'hud hud--nitro' : 'hud'}>
      <div className="hud-speedlines" aria-hidden="true" />
      <div className="hud-tl">
        <div className="hud-lap">
          <span className="eyebrow">Lap</span>
          <b>{Math.max(t.lap, 1)}</b>
          <span className="hud-lap__total">/{t.totalLaps}</span>
        </div>
        <div className="hud-times">
          <div>
            <span className="eyebrow">Time</span>
            <span className="mono">{formatTime(t.currentLapMs)}</span>
          </div>
          <div>
            <span className="eyebrow">Best</span>
            <span className="mono">{formatTime(t.bestLapMs)}</span>
          </div>
        </div>
      </div>
      <div className="hud-fps mono">{t.fps} FPS</div>

      {phase === 'countdown' && t.countdown > 0 && (
        <div className="countdown" key={Math.ceil(t.countdown)}>
          {Math.ceil(t.countdown)}
        </div>
      )}

      <div className="speedo">
        <div className="speedo__rpm" aria-hidden="true">
          {Array.from({ length: RPM_SEGMENTS }, (_, i) => (
            <i key={i} className={i < lit ? (i >= RPM_SEGMENTS - 3 ? 'on red' : 'on') : ''} />
          ))}
        </div>
        <Meter
          label="Nitro"
          value={t.nitro}
          state={t.nitroActive ? 'active' : t.nitroReady ? 'ready' : 'empty'}
          hint={t.nitroReady && !t.nitroActive ? <kbd>Shift</kbd> : undefined}
        />
        <div className="speedo__row">
          <span className="speedo__gear">{gearLabel(t.gear)}</span>
          <span className="speedo__speed mono">{Math.round(t.speedKmh)}</span>
          <span className="speedo__unit">km/h</span>
        </div>
      </div>
    </div>
  )
}
