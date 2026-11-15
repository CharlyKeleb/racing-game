import { useShallow } from 'zustand/react/shallow'
import { driftEvent, driftMedal } from '../racing/driftEvents'
import { formatTime } from '../racing/LapTimer'
import { useGameInstance } from './GameContext'
import { GiCoins } from 'react-icons/gi'
import { DAILY_SOFT_CAP } from '../racing/Economy'
import { useCareer, useGame, useTelemetry, useWallet } from './hooks'
import { careerEvent, formatLap } from '../racing/Career'
import { careerStore } from '../stores/careerStore'
import { Button, Panel } from './kit'
import { LeaderboardResult } from './LeaderboardResult'

export function Results() {
  const position = useTelemetry(s => s.finishPosition)
  const field = useTelemetry(s => s.finishFieldSize)
  const track = useGame(s => s.trackName)
  const drift = useGame(s => s.settings.mode === 'drift')
  const score = useTelemetry(s => s.driftTotal)
  const t = useTelemetry(useShallow(s => ({ driftBestChain: s.driftBestChain, driftBusts: s.driftBusts, driftLongest: s.driftLongest, driftNewBest: s.driftNewBest, driftPeakCombo: s.driftPeakCombo, driftPersonalBest: s.driftPersonalBest, driftTransitions: s.driftTransitions, driftZoneSeconds: s.driftZoneSeconds })))
  const event=driftEvent(useGame(s=>s.settings.driftEvent))
  const medal=driftMedal(score,event.targets)
  const game = useGameInstance()
  const standings = useTelemetry((s) => s.standings)
  const total = useTelemetry((s) => s.totalMs)
  const best = useTelemetry((s) => s.bestLapMs)
  const trial = useGame(s => s.settings.mode === 'timeTrial')
  const career = useCareer(s => s.active)
  if (trial) return <TrialResults />
  return (
    <div className={`screen screen--center ${drift ? '' : 'screen--race-results'}`}>
      <Panel title={drift ? 'Drift complete' : undefined} className="results-panel">
        <CareerBanner />
        {!drift && !career && <div className="race-result__hero">
          <span className="eyebrow">{track} / RACE RESULT</span>
          <h1>{field === 1 ? 'RUN COMPLETE' : position === 1 ? 'VICTORY' : 'RACE COMPLETE'}</h1>
          <div className="race-result__position">{field === 1 ? 'SOLO' : `P${position}`}<small>{field > 1 ? ` / ${field}` : ' RUN'}</small></div>
          <p>{field === 1 ? 'Your time is on the board.' : position === 1 ? 'First across the line.' : position <= 3 && field > 2 ? 'A podium finish. Keep pushing.' : 'The next race is yours to chase.'}</p>
        </div>}
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
        <PayoutSummary />
        {drift && <LeaderboardResult mode="drift" />}
        {standings.length > 1 && <ol className="race-standings" aria-label="Race standings">{standings.map(s => <li key={s.id} className={s.player ? 'race-standings__player' : ''}><b>{s.position}</b><span>{s.name}</span><span className="mono">{s.finishMs === null ? 'Racing' : formatTime(s.finishMs)}</span></li>)}</ol>}
        {career ? <CareerButtons /> : <>
          <Button variant="primary" size="lg" onClick={() => game?.startRace()} autoFocus>
            {drift ? 'Drift again' : 'Race again'}
          </Button>
          <Button variant="ghost" onClick={() => game?.quitToMenu()}>
            Main menu
          </Button>
        </>}
      </Panel>
    </div>
  )
}

/** What the race paid, line by line, and the balance it leaves. */
function PayoutSummary() {
  const payout = useWallet((s) => s.lastPayout)
  const coins = useWallet((s) => s.coins)
  if (!payout) return null
  return (
    <section className="payout" aria-label="Coins earned">
      <header><GiCoins aria-hidden="true" /><span className="eyebrow">Coins earned</span><b>+{payout.paid.toLocaleString()}</b></header>
      {payout.lines.length ? <ul>{payout.lines.map((l) => <li key={l.label}><span>{l.label}</span><b>+{l.coins.toLocaleString()}</b></li>)}</ul> : <p>No coins this time. Finish the race to get paid.</p>}
      {payout.paid < payout.earned && <p className="payout__cap">Past today's {DAILY_SOFT_CAP.toLocaleString()} coins, races pay a quarter. Full pay again tomorrow.</p>}
      <footer><span>Balance</span><b>{coins.toLocaleString()}</b></footer>
    </section>
  )
}

/** Time Trial session summary: best laps and whether this one set a new personal best. */
function TrialResults() {
  const game = useGameInstance()
  const track = useGame(s => s.trackName)
  const car = useGame(s => s.carName)
  const t = useTelemetry(useShallow(s => ({ best: s.trialSessionBestMs, pb: s.trialPersonalBestMs, laps: s.trialLaps, valid: s.trialValidLaps, total: s.totalMs })))
  const newPb = t.best !== null && t.best === t.pb
  const career = useCareer(s => s.active)
  return (
    <div className="screen screen--center screen--race-results">
      <Panel className="results-panel">
        <CareerBanner />
        {!career && <div className="race-result__hero">
          <span className="eyebrow">{track} / TIME TRIAL / {car}</span>
          <h1>{newPb ? 'NEW PERSONAL BEST' : 'SESSION COMPLETE'}</h1>
          <div className="race-result__position mono">{formatTime(t.best)}<small> SESSION BEST</small></div>
          <p>{t.best === null ? 'No valid lap this time. Drive through every checkpoint without a reset.' : newPb ? 'That lap is the new benchmark for this car and build.' : `Your personal best still stands at ${formatTime(t.pb)}.`}</p>
        </div>}
        <dl className="results">
          <dt>Personal best</dt>
          <dd className="mono">{formatTime(t.pb)}</dd>
          <dt>Laps</dt>
          <dd className="mono">{t.valid} valid / {t.laps}</dd>
          <dt>Session time</dt>
          <dd className="mono">{formatTime(t.total)}</dd>
        </dl>
        <PayoutSummary />
        <LeaderboardResult mode="timeTrial" />
        {career ? <CareerButtons /> : <>
          <Button variant="primary" size="lg" onClick={() => game?.startRace()} autoFocus>New session</Button>
          <Button variant="ghost" onClick={() => game?.quitToMenu()}>Main menu</Button>
        </>}
      </Panel>
    </div>
  )
}

/** Career: did this run win the event, and why not. */
function CareerBanner() {
  const result = useCareer(s => s.lastResult)
  const active = useCareer(s => s.active)
  const event = active ? careerEvent(active) : undefined
  if (!event) return null
  const passed = result?.passed ?? false
  const o = result?.outcome
  const detail = !o ? 'Run ended.'
    : o.kind === 'race' ? (passed ? `P${o.position} of ${o.field}. Event won.` : `P${o.position} of ${o.field}. Only ${event.maxPosition === 1 ? 'a win' : `P${event.maxPosition} or better`} clears it.`)
    : o.kind === 'elimination' ? (passed ? 'Last car standing.' : `Knocked out on lap ${o.lap}. Stay out of last when the leader starts a lap.`)
    : passed ? `${formatLap(o.bestLapMs ?? 0)} beats the ${formatLap(event.targetMs ?? 0)} target.`
    : `${o.bestLapMs === null ? 'No valid lap' : formatLap(o.bestLapMs)} against a ${formatLap(event.targetMs ?? 0)} target.`
  return (
    <div className={`career-result career-result--${passed ? 'won' : 'lost'}`} role="status">
      <span className="eyebrow">Career · {event.name}</span>
      <h1>{passed ? (result?.firstWin ? 'EVENT WON' : 'WON AGAIN') : o?.kind === 'elimination' ? 'ELIMINATED' : 'NOT THIS TIME'}</h1>
      <p>{detail}{passed && result?.firstWin && event.next.length > 0 ? ' The next rung is open.' : ''}{passed && event.next.length === 0 && event.id !== 'summit' ? ' A dead end: this route goes no higher.' : ''}{passed && event.id === 'summit' ? ' You reached the top of the ladder.' : ''}</p>
    </div>
  )
}

function CareerButtons() {
  const game = useGameInstance()
  return <>
    <Button variant="primary" size="lg" onClick={() => game?.startRace()} autoFocus>Retry event</Button>
    <Button variant="ghost" onClick={() => { careerStore.setState({ showLadder: true }); game?.quitToMenu() }}>Back to career</Button>
  </>
}
