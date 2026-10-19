import { useLayoutEffect, useRef } from 'react'
import { hudLayoutStore, measureHudPanels } from '../stores/hudLayoutStore'
import { DriftEventHud, DriftComboHud } from './DriftHud'
import { formatTime } from '../racing/LapTimer'
import { useGame, useTelemetry } from './hooks'
import { Minimap } from './Minimap'
import { Leaderboard, PositionBadge } from './RacePosition'
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
  const root = useRef<HTMLDivElement>(null)
  const t = useTelemetry((s) => s)
  const drift = useGame(s => s.settings.mode === 'drift')
  const phase = useGame((s) => s.phase)
  useLayoutEffect(() => {
    const element = root.current!
    const measure = () => hudLayoutStore.setState({ panels: measureHudPanels(element) })
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.querySelectorAll('[data-tag-exclusion], [data-tag-exclusion] > *').forEach(panel => observer.observe(panel))
    window.addEventListener('resize', measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      hudLayoutStore.setState({ panels: [] })
    }
  }, [drift, t.standings.length, phase])
  // Shift light just under the redline; needles sweep once on the start countdown.
  const shift = t.gear > 0 && t.rpm >= t.redlineRpm * 0.94
  const sweep = phase === 'countdown'
  // Lights out: flash GO for the first moments of the race.
  const go = phase === 'racing' && t.lap === 1 && t.totalMs < 900

  return (
    <div ref={root} className={`hud${t.nitroActive ? ' hud--nitro' : ''}${t.nitroPerfect ? ' hud--nitro-perfect' : ''}`}>
      <div className="hud-speedlines" aria-hidden="true" />
      <div className="hud-tl" data-tag-exclusion>
        {t.standings.length > 1 && <PositionBadge position={t.standings.find(s => s.player)?.position ?? 1} total={t.standings.length} />}
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
      <div className="hud-tr" data-tag-exclusion>
        <div className="hud-fps mono">{t.fps} FPS</div>
        {t.standings.length > 1 && <Leaderboard standings={t.standings} />}
      </div>
      <div className="hud-bl">
        <Minimap />
      </div>

      <RivalTags />
      {t.drafting > 0.15 && phase === 'racing' && <div className="hud-drafting"><span>Slipstream</span><b>Building nitro</b></div>}
      {t.wrongWay ? <div className="hud-wrongway">Wrong way</div> : t.missedCheckpoint && <div className="hud-wrongway hud-wrongway--missed">Missed checkpoint<small>Press R to go back</small></div>}

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
