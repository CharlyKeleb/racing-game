import { DriftEventHud, DriftComboHud } from './DriftHud'
import { formatTime } from '../racing/LapTimer'
import { useGame, useTelemetry } from './hooks'
import { Minimap } from './Minimap'
import { RivalTags } from './RivalTags'
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
  const drift = useGame(s => s.settings.mode === 'drift')
  const phase = useGame((s) => s.phase)
  // Shift light just under the redline; needles sweep once on the start countdown.
  const shift = t.gear > 0 && t.rpm >= t.redlineRpm * 0.94
  const sweep = phase === 'countdown'
  // Lights out: flash GO for the first moments of the race.
  const go = phase === 'racing' && t.lap === 1 && t.totalMs < 900

  return (
    <div className={`hud${t.nitroActive ? ' hud--nitro' : ''}${t.nitroPerfect ? ' hud--nitro-perfect' : ''}`}>
      <div className="hud-speedlines" aria-hidden="true" />
      <div className="hud-tl">
        {t.standings.length > 1 && <div className="hud-lap" aria-label="Race position"><span className="eyebrow">Position</span><b>{t.standings.find(s => s.player)?.position ?? 1}</b><span className="hud-lap__total">/{t.standings.length}</span></div>}
        {drift ? <DriftEventHud /> : <><div className="hud-lap">
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
        </>}
      </div>
      <div className="hud-tr">
        <div className="hud-fps mono">{t.fps} FPS</div>
        {t.standings.length > 1 && <ol className="hud-field" aria-label="Race leaderboard">{t.standings.map(s => <li key={s.id} className={s.player ? 'hud-field__player' : ''}><b>{s.position}</b><span>{s.name.split(' · ')[0]}</span><small className="mono">{s.position === 1 ? 'LEADER' : s.gapMs !== null ? `+${(s.gapMs / 1000).toFixed(2)}s` : s.gapLaps > 0 ? `+${s.gapLaps} LAP` : `+${Math.round(s.gapMeters)}m`}</small></li>)}</ol>}
      </div>
      <div className="hud-bl">
        <Minimap />
      </div>

      <RivalTags />
      {t.drafting > 0.15 && phase === 'racing' && <div className="hud-drafting"><span>Slipstream</span><b>Building nitro</b></div>}
      {t.wrongWay && <div className="hud-wrongway">Wrong way</div>}

      {drift ? <DriftComboHud /> : t.driftActive ? (
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

      {(phase === 'countdown' || go) && (
        <div className={`start-lights${go ? ' start-lights--go' : ''}`} role="img" aria-label={go ? 'Go' : `${t.startLights} of ${t.startLightCount} start lights lit`}>
          <div className="start-lights__gantry">
            {Array.from({ length: t.startLightCount }, (_, i) => (
              <span key={i} className={`start-lights__pod${i < t.startLights ? ' is-lit' : ''}`}><i /><i /></span>
            ))}
          </div>
          {go && <div className="start-lights__go">Go</div>}
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
