import { driftEvent, driftMedal } from '../racing/driftEvents'
import { useGame, useTelemetry } from './hooks'

export function DriftEventHud() {
  const t=useTelemetry(s=>s)
  const event=driftEvent(useGame(s=>s.settings.driftEvent))
  const secured=t.driftTotal
  const live=secured+t.driftChain
  const next=event.targets.find(target=>target>secured) ?? event.targets[2]
  const medal=driftMedal(secured,event.targets)
  return <section className="drift-event" aria-label="Drift event progress">
    <div className="drift-event__heading"><span className="eyebrow">{event.name}</span><span className="drift-event__sector">{t.totalLaps>1?`LAP ${Math.max(1,t.lap)}/${t.totalLaps}`:'GATES'} <b>{t.driftGate}/{t.driftGateCount}</b></span></div>
    <span className="drift-event__caption">DRIFT CHALLENGE / BANKED SCORE</span>
    <strong className="drift-event__score">{secured.toLocaleString()}</strong>
    <div className="drift-medals" aria-label="Medal targets">{event.targets.map((goal,i)=><span key={goal} className={secured>=goal?'is-earned':''}><i>{['B','S','G'][i]}</i><small>{(goal/1000).toFixed(goal%1000?1:0)}K</small></span>)}</div>
    <div className="drift-target-bar" role="progressbar" aria-label="Next medal" aria-valuenow={secured} aria-valuemin={0} aria-valuemax={Math.max(next,secured)}><i style={{width:`${Math.min(100,live/next*100)}%`}}/><b style={{width:`${Math.min(100,secured/next*100)}%`}}/></div>
    <div className="drift-event__target"><span>{medal==='Gold'?'GOLD SECURED':`${Math.max(0,next-secured).toLocaleString()} TO ${secured>=event.targets[1]?'GOLD':secured>=event.targets[0]?'SILVER':'BRONZE'}`}</span><small>PB {t.driftPersonalBest.toLocaleString()}</small></div>
  </section>
}

export function DriftComboHud() {
  const t=useTelemetry(s=>s)
  const event=driftEvent(useGame(s=>s.settings.driftEvent))
  const chain=t.driftChain>0
  const quality=t.driftScoring?(t.driftAngle>=45?'GREAT ANGLE':t.speedKmh>=100?'HIGH SPEED':'DRIFTING'):t.speedKmh<event.minSpeed?'BUILD SPEED':'TAP BRAKE + TURN'
  return <div className={`drift-combo ${t.driftScoring?'is-scoring':''} ${t.driftZone&&t.driftScoring?'is-zone':''}`}>
    {t.driftMessage && <div className={`drift-callout ${t.driftMessage.includes('LOST')?'is-bust':''}`} role="status">{t.driftMessage}</div>}
    <div className="drift-combo__state"><span>{t.driftZone&&t.driftScoring?'CLIPPING ZONE / 1.75×':quality}</span><small>{Math.round(t.driftAngle)}° <i>/</i> {Math.round(t.speedKmh)} KM/H</small></div>
    <div className="drift-combo__main"><div><span>UNBANKED CHAIN</span><strong>{chain?`+${t.driftChain.toLocaleString()}`:'GET SIDEWAYS'}</strong></div><div className="drift-combo__multiplier"><b>×{t.driftCombo}</b><div><i style={{width:`${t.driftComboProgress*100}%`}}/></div></div></div>
    <div className="drift-combo__link"><i style={{transform:`scaleX(${t.driftLink})`}}/></div>
    <div className="drift-combo__hint"><span>{chain?(t.driftScoring?'KEEP THE FLOW':'LINK NOW OR BANK'):`${event.minSpeed}+ KM/H · SPACE TO INITIATE`}</span><span>{t.driftCombo===5?'MAX MULTIPLIER':'LINK SLIDES TO BUILD ×5'}</span></div>
  </div>
}
