import { useShallow } from 'zustand/react/shallow'
import { driftEvent, driftMedal } from '../racing/driftEvents'
import { formatTime } from '../racing/LapTimer'
import { useGameInstance } from './GameContext'
import { useGame, useTelemetry } from './hooks'
import { Button, Panel } from './kit'

export function Results() {
  const drift = useGame(s => s.settings.mode === 'drift')
  const score = useTelemetry(s => s.driftTotal)
  const t = useTelemetry(useShallow(s => ({ driftBestChain: s.driftBestChain, driftBusts: s.driftBusts, driftLongest: s.driftLongest, driftNewBest: s.driftNewBest, driftPeakCombo: s.driftPeakCombo, driftPersonalBest: s.driftPersonalBest, driftTransitions: s.driftTransitions, driftZoneSeconds: s.driftZoneSeconds })))
  const event=driftEvent(useGame(s=>s.settings.driftEvent))
  const medal=driftMedal(score,event.targets)
  const game = useGameInstance()
  const standings = useTelemetry((s) => s.standings)
  const total = useTelemetry((s) => s.totalMs)
  const best = useTelemetry((s) => s.bestLapMs)
  return (
    <div className="screen screen--center">
      <Panel title={drift ? 'Drift complete' : 'Finished'} className="results-panel">
        {drift && <div className={`drift-result drift-result--${medal.toLowerCase()}`}>
          <span className="eyebrow">{event.name} / {t.driftNewBest?'NEW PERSONAL BEST':'SESSION COMPLETE'}</span>
          <div className="drift-result__medal">{medal==='Unranked'?'—':medal[0]}</div>
          <span>{medal==='Unranked'?'KEEP PUSHING':`${medal.toUpperCase()} MEDAL`}</span>
          <strong>{score.toLocaleString()}</strong><span>POINTS BANKED</span>
          <div className="drift-result__targets">{event.targets.map((goal,i)=><span key={goal} className={score>=goal?'is-earned':''}>{['BRONZE','SILVER','GOLD'][i]}<b>{goal.toLocaleString()}</b></span>)}</div>
          <dl className="drift-result__stats"><div><dt>Best chain</dt><dd>{t.driftBestChain.toLocaleString()}</dd></div><div><dt>Longest drift</dt><dd>{t.driftLongest.toFixed(1)}s</dd></div><div><dt>Clean transitions</dt><dd>{t.driftTransitions}</dd></div><div><dt>Zone time</dt><dd>{t.driftZoneSeconds.toFixed(1)}s</dd></div><div><dt>Peak multiplier</dt><dd>×{t.driftPeakCombo}</dd></div><div><dt>Broken chains</dt><dd>{t.driftBusts}</dd></div></dl>
          <p>{t.driftNewBest?'A new benchmark. Can you beat it?':`Previous best: ${t.driftPersonalBest.toLocaleString()} · ${medal==='Gold'?'Gold secured. Chase a cleaner run.':'Link longer chains to reach the next medal.'}`}</p>
        </div>}
        <dl className="results">
          <dt>Total time</dt>
          <dd className="mono">{formatTime(total)}</dd>
          {!drift && <><dt>Best lap</dt><dd className="mono">{formatTime(best)}</dd></>}
        </dl>
        {standings.length > 1 && <ol className="race-standings" aria-label="Race standings">{standings.map(s => <li key={s.id} className={s.player ? 'race-standings__player' : ''}><b>{s.position}</b><span>{s.name}</span><span className="mono">{s.finishMs === null ? 'DNF' : formatTime(s.finishMs)}</span></li>)}</ol>}
        <Button variant="primary" size="lg" onClick={() => game?.startRace()} autoFocus>
          {drift ? 'Drift again' : 'Race again'}
        </Button>
        <Button variant="ghost" onClick={() => game?.quitToMenu()}>
          Main menu
        </Button>
      </Panel>
    </div>
  )
}
