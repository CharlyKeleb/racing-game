import { useLayoutEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { hudLayoutStore, measureHudPanels } from '../stores/hudLayoutStore'
import { DriftEventHud, DriftComboHud } from './DriftHud'
import { formatTime } from '../racing/LapTimer'
import { useGame, useTelemetry } from './hooks'
import { Minimap } from './Minimap'
import { Leaderboard, PositionBadge } from './RacePosition'
import { RivalTags } from './RivalTags'
import { ProximityDisplay } from './ProximityRadar'
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
  const t = useTelemetry(useShallow(s => ({ nitroActive: s.nitroActive, nitroPerfect: s.nitroPerfect })))
  const fieldSize = useTelemetry(s => s.standings.length)
  const drift = useGame(s => s.settings.mode === 'drift')
  const phase = useGame((s) => s.phase)
  const awarenessVisible=useGame(s=>s.settings.proximityRadar||s.settings.spotterVisual)
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
  }, [drift, fieldSize, phase, awarenessVisible])
  return (
    <div ref={root} className={`hud${t.nitroActive ? ' hud--nitro' : ''}${t.nitroPerfect ? ' hud--nitro-perfect' : ''}`}>
      <div className="hud-speedlines" aria-hidden="true" />
      <HudRaceInfo />
      <HudLeaderboard />
      <div className="hud-bl">
        <Minimap />
      </div>

      <RivalTags />
      <ProximityDisplay />
      <HudFeedback />
      <HudStartLights />
      <HudLaunch />
      <HudGauges />
    </div>
  )
}

function HudRaceInfo() {
  const t = useTelemetry(useShallow(s => ({ bestLapMs: s.bestLapMs, currentLapMs: s.currentLapMs, lap: s.lap, fieldSize: s.standings.length, position: s.standings.find(entry => entry.player)?.position ?? 1, totalLaps: s.totalLaps })))
  const drift = useGame(s => s.settings.mode === 'drift')
  return (
    <>
      <div className="hud-tl" data-tag-exclusion>
        {t.fieldSize > 1 && <PositionBadge position={t.position} total={t.fieldSize} />}
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
    </>
  )
}

function HudLeaderboard() {
  const t = useTelemetry(useShallow(s => ({ fps: s.fps, standings: s.standings })))
  return (
    <>
      <div className="hud-tr" data-tag-exclusion>
        <div className="hud-fps mono">{t.fps} FPS</div>
        {t.standings.length > 1 && <Leaderboard standings={t.standings} />}
      </div>
    </>
  )
}

function HudFeedback() {
  const t = useTelemetry(useShallow(s => ({ drafting: s.drafting > .15, driftActive: s.driftActive, driftBanked: s.driftBanked, driftScore: s.driftScore, nitroMissed: s.nitroMissed, nitroPerfect: s.nitroPerfect, nitroWindow: s.nitroWindow, wrongWay: s.wrongWay, missedCheckpoint: s.missedCheckpoint })))
  const drift = useGame(s => s.settings.mode === 'drift')
  const phase = useGame(s => s.phase)
  return (
    <>
      {t.drafting && phase === 'racing' && <div className="hud-drafting"><span>Slipstream</span><b>Building nitro</b></div>}
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

    </>
  )
}

function HudStartLights() {
  const t = useTelemetry(useShallow(s => ({ go: s.lap === 1 && s.totalMs < 900, startLightCount: s.startLightCount, startLights: s.startLights })))
  const phase = useGame(s => s.phase)
  const go = phase === 'racing' && t.go
  return (
    <>
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

    </>
  )
}

const LAUNCH_CALLS: Record<string, string> = { perfect: 'Perfect launch', good: 'Good launch', poor: 'Bogged down', early: 'Too early' }

/** Grid rev band + how-to during the countdown, then the launch grade at lights-out (#91). */
function HudLaunch() {
  const t = useTelemetry(useShallow(s => ({ armed: s.launchArmed, flash: s.launchFlash, grade: s.launchGrade, high: s.launchBandHigh, low: s.launchBandLow, revs: s.launchRevs })))
  const phase = useGame(s => s.phase)
  const assist = useGame(s => s.settings.launchAssist)
  const inBand = t.revs >= t.low && t.revs <= t.high
  if (phase === 'countdown') {
    return (
      <div className={`launch-cue${t.armed ? ' is-armed' : ''}${inBand ? ' is-in-band' : ''}`}>
        {!assist && (
          <div className="launch-cue__meter" role="meter" aria-label="Launch revs" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(t.revs * 100)}>
            <span className="launch-cue__band" style={{ left: `${t.low * 100}%`, width: `${(t.high - t.low) * 100}%` }} />
            <span className="launch-cue__needle" style={{ left: `${Math.min(1, Math.max(0, t.revs)) * 100}%` }} />
          </div>
        )}
        <p className="launch-cue__hint">
          {assist
            ? <>Launch assist · hold <kbd>↑</kbd> throttle</>
            : t.armed ? <>Revs in the green · <b>let go at lights out</b></> : <>Hold <kbd>Space</kbd> or brake · rev into the green · let go at lights out</>}
        </p>
      </div>
    )
  }
  if (phase === 'racing' && t.flash && LAUNCH_CALLS[t.grade]) {
    return <div className={`hud-nitro-call launch-call launch-call--${t.grade}`}>{LAUNCH_CALLS[t.grade]}</div>
  }
  return null
}

function HudGauges() {
  const t = useTelemetry(useShallow(s => ({ gear: s.gear, nitro: s.nitro, nitroActive: s.nitroActive, nitroCue: s.nitroCue, nitroPerfect: s.nitroPerfect, nitroReady: s.nitroReady, nitroWindow: s.nitroWindow, redlineRpm: s.redlineRpm, rpm: s.rpm, speedKmh: s.speedKmh })))
  const sweep = useGame(s => s.phase === 'countdown')
  const shift = t.gear > 0 && t.rpm >= t.redlineRpm * .94
  return (
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
  )
}
