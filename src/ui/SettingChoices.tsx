import { Help } from './Help'
import { optionHelp } from './optionHelp'
import type { ReactNode } from 'react'

/** Lightweight illustrative thumbnails; selecting a card applies the real setting. */
export function SettingChoices<T extends string | number>({ label, value, options, onPick, preview }: {
  label: string; value: T; options: [T,string][]; onPick(value:T):void; preview(value:T):ReactNode
}) {
  return <div className="ui-field"><span className="ui-field__label">{label}{optionHelp[label] && <Help label={label}>{optionHelp[label]}</Help>}</span>
    <div className="setting-choices" role="radiogroup" aria-label={label}>
      {options.map(([id,text])=><button key={id} role="radio" aria-checked={id===value} onClick={()=>onPick(id)} className={id===value?'is-selected':''}>
        <span className="setting-choices__image" aria-hidden="true">{preview(id)}</span>
        <span className="setting-choices__label">{text}<i aria-hidden="true">{id===value?'✓':''}</i></span>
      </button>)}
    </div>
  </div>
}

/** Stylized road scene: illustrates the option without creating another game renderer. */
export function SettingScene({ time='noon', quality='high', cockpit=false, effects=false }: {
  time?:string; quality?:string; cockpit?:boolean; effects?:boolean
}) {
  const sky = time==='night'?'#101b38':time==='golden'?'#dc926b':time==='overcast'?'#84949e':'#82c9df'
  const grass = time==='night'?'#142b35':time==='golden'?'#665d40':'#436552'
  return <svg viewBox="0 0 180 92" preserveAspectRatio="xMidYMid slice" focusable="false">
    <rect width="180" height="92" fill={sky}/>
    {time==='night'?<><circle cx="145" cy="19" r="7" fill="#e0eaff"/><path d="M20 12h2m30 8h2m55-7h2" stroke="#fff"/></>:time==='overcast'?<path d="M0 17q20-12 40 0t45 0t50 0t50 0" stroke="#c0ccd2" strokeWidth="14" fill="none"/>:<circle cx="145" cy={time==='golden'?39:18} r="10" fill="#ffe8aa"/>}
    <path d="M0 48 30 29 65 45 100 26 146 44 180 31V92H0Z" fill={grass}/>
    <path d="M78 43 0 92H180L102 43Z" fill="#323e4a"/>
    {quality!=='low'&&<><path d="M77 44 4 92M103 44l73 48" stroke="#dce7dc" strokeWidth="2"/><path d="M16 65V49m-6 8 6-14 7 14Zm145 3V44m-7 8 7-16 8 16Z" stroke="#244837" fill="#244837" strokeWidth="3"/></>}
    {(quality==='high'||quality==='ultra')&&<><path d="M45 53v-9m-5 4 5-10 5 10M132 51V40m-5 5 5-11 6 11" stroke="#2a513d" fill="#2a513d"/><ellipse cx="90" cy="84" rx="23" ry="4" fill="#15202e" opacity=".7"/></>}
    <path d="m90 48 0 6m0 6v10m0 9v13" stroke="#ebdda8" strokeWidth="2"/>
    {cockpit?<><path d="M0 74q90-24 180 0v18H0Z" fill="#111b29"/><path d="m7 0 24 65M173 0l-24 65" stroke="#111b29" strokeWidth="9"/><ellipse cx="90" cy="88" rx="25" ry="19" stroke="#7a8a98" strokeWidth="5" fill="none"/><path d="M70 81h40m-20 0v11" stroke="#7a8a98" strokeWidth="3"/><circle cx="90" cy="77" r="3" fill="#36c9ed"/></>:<><path d="m71 80 4-19q15-7 30 0l4 19-3 5H74Z" fill="#e64e41"/><path d="m78 62 3-6h18l3 6v7H78Z" fill="#1b3a4c"/><path d="M74 78h9m14 0h9" stroke="#ffb8a1" strokeWidth="3"/><path d="M76 84v4m28-4v4" stroke="#101b27" strokeWidth="4"/></>}
    {effects&&<><circle cx="145" cy="19" r="17" fill="#ffe8aa" opacity=".17"/><path d="M73 78h10m14 0h10" stroke="#ff9e7e" strokeWidth="7" opacity=".25"/><path d="m8 85 20-10m124 0 20 10" stroke="#8bdfff" opacity=".6"/></>}
  </svg>
}
