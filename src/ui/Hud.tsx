import { formatTime } from '../racing/LapTimer'
import { useGame, useTelemetry } from './hooks'
import { Meter } from './kit'
import { Minimap } from './Minimap'
import { Speedometer } from './Speedometer'

/** Dial full scale. Comfortably above the 911's ~306 km/h top speed. */
const DIAL_MAX_KMH = 340

function gearLabel(gear: number): string {
  if (gear < 0) return 'R'
  if (gear === 0) return 'N'
  return String(gear)
}

export function Hud() {
  const t = useTelemetry((s) => s)
  const phase = useGame((s) => s.phase)

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
      <div className="hud-tr">
        <div className="hud-fps mono">{t.fps} FPS</div>
      </div>
      <div className="hud-bl">
        <Minimap />
      </div>

      {t.wrongWay && <div className="hud-wrongway">Wrong way</div>}

      {phase === 'countdown' && t.countdown > 0 && (
        <div className="countdown" key={Math.ceil(t.countdown)}>
          {Math.ceil(t.countdown)}
        </div>
      )}

      <div className="speedo">
        <Speedometer speedKmh={t.speedKmh} maxKmh={DIAL_MAX_KMH} rpm={t.rpm} redlineRpm={t.redlineRpm} gear={gearLabel(t.gear)} nitro={t.nitroActive} />
        <Meter
          label="Nitro"
          value={t.nitro}
          state={t.nitroActive ? 'active' : t.nitroReady ? 'ready' : 'empty'}
          hint={t.nitroReady && !t.nitroActive ? <kbd>Shift</kbd> : undefined}
        />
      </div>
    </div>
  )
}
