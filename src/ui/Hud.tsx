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
  const speedLines = useGame((s) => s.settings.speedLines)
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
      {speedLines && <div className="hud-speedlines" aria-hidden="true" />}
      <HudRaceInfo />
      <HudLeaderboard />
      <div className="hud-bl">
        <Minimap />
      </div>

      <RivalTags />
      <ProximityDisplay />
      <HudFeedback />
      <HudStartLights />
      <HudCallout />
      <HudLaunch />
      <HudTrialCall />
      <HudGauges />
    </div>
  )
}

function HudRaceInfo() {
  const t = useTelemetry(useShallow(s => ({ bestLapMs: s.bestLapMs, currentLapMs: s.currentLapMs, lap: s.lap, fieldSize: s.standings.length, position: s.standings.find(entry => entry.player)?.position ?? 1, totalLaps: s.totalLaps })))
  const drift = useGame(s => s.settings.mode === 'drift')
  const mode = useGame(s => s.settings.mode)
  if (mode === 'timeTrial') return <div className="hud-tl" data-tag-exclusion><TrialHud /></div>
  if (mode === 'freeRoam') return <div className="hud-tl" data-tag-exclusion><RoamHud /></div>
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

/** Time Trial: lap, live time, session best and PB, the next gate, and whether this lap still counts. */
function TrialHud() {
  const t = useTelemetry(useShallow(s => ({ currentLapMs: s.currentLapMs, lap: s.trialLap, valid: s.trialValid, reason: s.trialInvalidReason, best: s.trialSessionBestMs, pb: s.trialPersonalBestMs, next: s.trialNextGate, gates: s.trialGateCount })))
  const gate = t.next === 0 ? 'Finish' : `${t.next}/${Math.max(1, t.gates - 1)}`
  return <>
    <div className="hud-lap">
      <span className="eyebrow">Lap</span>
      <b>{t.lap}</b>
    </div>
    <div className="hud-times">
      <div><span className="eyebrow">Time</span><span className={`mono${t.valid ? '' : ' trial-invalid-time'}`}>{formatTime(t.currentLapMs)}</span></div>
      <div><span className="eyebrow">Best</span><span className="mono">{formatTime(t.best)}</span></div>
      <div><span className="eyebrow">PB</span><span className="mono">{formatTime(t.pb)}</span></div>
    </div>
    <div className="hud-trial-gate">
      <span className="eyebrow">Checkpoint</span>
      <b>{gate}</b>
      {!t.valid && <span className="hud-trial-gate__invalid">{t.reason === 'reset' ? 'Lap void · reset' : 'Lap void · missed gate'}</span>}
      <small><kbd>T</kbd> restart</small>
    </div>
  </>
}

/** Free Roam: no clock, just what the keys do. */
function RoamHud() {
  return <div className="hud-roam">
    <b>Free roam</b>
    <small><kbd>R</kbd> nearest checkpoint · <kbd>T</kbd> back to start · <kbd>Esc</kbd> menu</small>
  </div>
}

/** Time Trial split at each checkpoint and the lap call at the line, NFS style: green ahead of your PB, red behind. */
function HudTrialCall() {
  const t = useTelemetry(useShallow(s => ({ show: s.trialSplitShow, index: s.trialSplitIndex, split: s.trialSplitMs, delta: s.trialDeltaMs, lap: s.trialLastLap, gates: s.trialGateCount })))
  const mode = useGame(s => s.settings.mode)
  const phase = useGame(s => s.phase)
  if (mode !== 'timeTrial' || phase !== 'racing' || !t.show || t.index < 0) return null
  const delta = t.delta === null ? null : `${t.delta <= 0 ? '−' : '+'}${(Math.abs(t.delta) / 1000).toFixed(3)}`
  const tone = t.delta === null ? '' : t.delta <= 0 ? ' is-ahead' : ' is-behind'
  if (t.index === 0 && t.lap) {
    const label = !t.lap.valid ? 'Lap void' : t.lap.personalBest ? 'New personal best' : t.lap.sessionBest ? 'Session best' : 'Lap'
    return <div className={`trial-call trial-call--lap${t.lap.valid ? tone : ' is-void'}${t.lap.personalBest ? ' is-pb' : ''}`} key={`lap-${t.split}`} role="status">
      <span>{label}</span>
      <b className="mono">{formatTime(t.lap.lapMs)}</b>
      {t.lap.valid && delta && <em className="mono">{delta}</em>}
    </div>
  }
  return <div className={`trial-call${tone}`} key={`cp-${t.index}-${t.split}`} role="status">
    <span>Checkpoint {t.index}/{Math.max(1, t.gates - 1)}</span>
    <b className="mono">{formatTime(t.split)}</b>
    {delta && <em className="mono">{delta}</em>}
  </div>
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

/** Quick Race callout (#90): one short line under the top of the screen, announced to screen readers. */
function HudCallout() {
  const callout = useTelemetry(s => s.callout)
  return <div className="race-callout-slot" aria-live="polite">
    {callout && <div key={callout.id} className={`race-callout race-callout--${callout.kind}`}>
      <b>{callout.text}</b>{callout.detail && <span className="mono">{callout.detail}</span>}
    </div>}
  </div>
}

function HudGauges() {
  const t = useTelemetry(useShallow(s => ({ gear: s.gear, nitro: s.nitro, nitroActive: s.nitroActive, nitroCue: s.nitroCue, nitroPerfect: s.nitroPerfect, nitroReady: s.nitroReady, nitroWindow: s.nitroWindow, redlineRpm: s.redlineRpm, rpm: s.rpm, speedKmh: s.speedKmh })))
  const sweep = useGame(s => s.phase === 'countdown')
  const hidden = useGame(s => s.settings.mode === 'freeRoam' && !s.settings.roamHud)
  const shift = t.gear > 0 && t.rpm >= t.redlineRpm * .94
  if (hidden) return null
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
