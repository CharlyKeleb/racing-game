import {useStore} from 'zustand'
import {proximityStore} from '../stores/proximityStore'
import {useGame,useTelemetry} from './hooks'
import {ProximityRadar,type SpotterCue} from '../racing/ProximityRadar'
const labels:Record<SpotterCue,string>={left:'Car left',right:'Car right',both:'Both sides','clear-left':'Clear left','clear-right':'Clear right',clear:'All clear'}
const idleRadar=new ProximityRadar()

export function ProximityDisplay(){
  const radar=useStore(proximityStore).radar??idleRadar
  const fieldSize=useTelemetry(s=>s.standings.length)
  const phase=useGame(s=>s.phase),enabled=useGame(s=>s.settings.proximityRadar),text=useGame(s=>s.settings.spotterVisual)
  if(phase!=='racing'||(!enabled&&!text)||fieldSize<=1)return null
  const message=radar.left&&radar.right?'Both sides':radar.left?'Car left':radar.right?'Car right':radar.rear?'Closing behind':radar.notice?labels[radar.notice]:''
  return <div className={`proximity${!enabled?' proximity--text-only':''}`} data-tag-exclusion aria-label="Nearby race traffic">
    <div className="proximity__panel">
      {enabled&&<>
        <span className="proximity__title">Proximity</span>
        <svg viewBox="0 0 120 124" role="img" aria-label={`Rivals relative to your car. ${message||'No immediate overlap'}`}>
          <path d="M20 12H100V112H20Z M60 12V112 M20 62H100" fill="none" stroke="#a4c7df24" strokeDasharray="3 4"/>
          <path d="M54 9L60 3L66 9" fill="none" stroke="#b6cddd" strokeWidth="1.5"/>
          {text&&<><rect x="8" y="49" width="4" height="26" rx="2" fill={radar.left?'#ff6555':'#54677a55'}/><rect x="108" y="49" width="4" height="26" rx="2" fill={radar.right?'#ff6555':'#54677a55'}/></>}
          <rect x="55" y="55" width="10" height="15" rx="2" fill="#eaf5ff"/><path d="M57 59H63" stroke="#163244" strokeWidth="2"/>
          {radar.contacts.map(c=>{
            if(!c.active)return null
            const x=60-c.left*5,y=62-c.forward*1.5
            return <g key={c.id} transform={`translate(${x} ${y}) rotate(${-c.angle*180/Math.PI})`}>
              {c.approaching&&<rect x="-6" y="-8" width="12" height="16" rx="3" fill="none" stroke="#ffd064" strokeWidth="1"/>}
              <rect x="-4" y="-6" width="8" height="12" rx="1.5" fill={c.overlap?'#ff6555':c.approaching?'#ffd064':'#74c9ef'}/>
              <path d="M-2 -3H2" stroke="#12232e" strokeWidth="1.5"/>
            </g>
          })}
        </svg>
      </>}
      {text&&<span className={`proximity__cue${radar.left||radar.right?' proximity__cue--overlap':''}`} role="status" aria-live="polite" aria-atomic="true">{message||'32 m range'}</span>}
    </div>
  </div>
}
