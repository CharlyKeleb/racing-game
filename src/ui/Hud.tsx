import { formatTime } from '../racing/LapTimer'
import { useGame, useTelemetry } from './hooks'
import { Minimap } from './Minimap'
import { NitroGauge, RpmGauge, Speedometer } from './Speedometer'

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
  // Shift light just under the redline; needles sweep once on the start countdown.
  const shift = t.gear > 0 && t.rpm >= t.redlineRpm * 0.94
  const sweep = phase === 'countdown'

  return (
    <div className={`hud${t.nitroActive ? ' hud--nitro' : ''}${t.nitroPerfect ? ' hud--nitro-perfect' : ''}`}>
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

      {t.driftActive ? (
        <div className="hud-drift">
          <span className="hud-drift__label">Drift</span>
          <b className="hud-drift__score">{t.driftScore.toLocaleString()}</b>
        </div>
      ) : t.driftBanked > 0 ? (
        <div className="hud-drift hud-drift--banked" key={t.driftBanked}>
          <b className="hud-drift__score">+{t.driftBanked.toLocaleString()}</b>
        </div>
      ) : null}

      {t.nitroPerfect ? (
        <div className="hud-nitro-call hud-nitro-call--perfect">Perfect nitro</div>
      ) : t.nitroWindow ? (
        <div className="hud-nitro-call hud-nitro-call--tap">
          Tap <kbd>Shift</kbd>
        </div>
      ) : t.nitroMissed ? (
        <div className="hud-nitro-call hud-nitro-call--missed">Missed</div>
      ) : null}

      {phase === 'countdown' && t.countdown > 0 && (
        <div className="countdown" key={Math.ceil(t.countdown)}>
          {Math.ceil(t.countdown)}
        </div>
      )}

      <div className="speedo">
        <div className="speedo__side">
          <RpmGauge rpm={t.rpm} redlineRpm={t.redlineRpm} shift={shift} sweep={sweep} />
          <NitroGauge
            level={t.nitro}
            active={t.nitroActive}
            ready={t.nitroReady}
            cue={t.nitroCue}
            windowOpen={t.nitroWindow}
            perfect={t.nitroPerfect}
            sweep={sweep}
          />
        </div>
        <Speedometer speedKmh={t.speedKmh} maxKmh={DIAL_MAX_KMH} gear={gearLabel(t.gear)} shift={shift} nitro={t.nitroActive} sweep={sweep} />
      </div>
    </div>
  )
}
