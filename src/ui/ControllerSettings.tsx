import { useState } from 'react'
import { useStore } from 'zustand'
import { controllerStore } from '../stores/controllerStore'

const bindings = [
  ['Steer', 'Left stick', 'Left stick'],
  ['Accelerate', 'RT', 'R2'],
  ['Brake / reverse', 'LT', 'L2'],
  ['Handbrake', 'A', '×'],
  ['Nitro', 'X / RB', '□ / R1'],
  ['Change camera', 'Y', '△'],
  ['Reset car', 'B', '○'],
  ['Pause / resume', 'Menu', 'Options'],
] as const

function ControllerArt({ playstation }: { playstation: boolean }) {
  return <svg className="controller-page__art" viewBox="0 0 420 220" role="img" aria-label="Controller with left stick, triggers and face buttons">
    <defs>
      <linearGradient id="pad-shell" x2="0.2" y2="1"><stop stopColor="#445268"/><stop offset=".5" stopColor="#253244"/><stop offset="1" stopColor="#141e2d"/></linearGradient>
      <linearGradient id="pad-edge" x2="0" y2="1"><stop stopColor="#9caec1"/><stop offset="1" stopColor="#253246"/></linearGradient>
    </defs>
    <ellipse cx="210" cy="193" rx="136" ry="14" fill="#000" opacity=".3"/>
    <path d="M99 55 L103 32 Q123 20 151 29 L153 52 M267 52 L269 29 Q297 20 317 32 L321 55" fill="#121c2a" stroke="#627189" strokeWidth="2"/>
    <path d="M110 45 Q88 45 79 75 L53 161 Q47 192 69 195 Q86 198 106 168 L135 142 L285 142 L314 168 Q334 198 351 195 Q373 192 367 161 L341 75 Q332 45 310 45 Z" fill="url(#pad-shell)" stroke="url(#pad-edge)" strokeWidth="2"/>
    <path d="M109 52 Q93 52 86 77 L64 151 M311 52 Q327 52 334 77 L356 151" fill="none" stroke="#8497ae" opacity=".25" strokeWidth="3"/>
    <rect x="165" y="55" width="90" height="45" rx="8" fill="#182332" stroke="#485970"/>
    <path d="M186 75 h9 M225 71 v8 m-4-4 h8" stroke="#8ba0b7" strokeWidth="2"/>
    <circle cx="123" cy="92" r="28" fill="#101926" stroke="#4b6178" strokeWidth="2"/>
    <circle cx="123" cy="92" r="19" fill="#26374b" stroke="#8aa0b5"/>
    <circle cx="123" cy="92" r="13" fill="none" stroke="#ffffff15"/>
    <path d="M157 119 h12 v12 h12 v12 h-12 v12 h-12 v-12 h-12 v-12 h12Z" fill="#101a29" stroke="#50637b"/>
    <circle cx="253" cy="135" r="24" fill="#101926" stroke="#4b6178"/>
    <circle cx="253" cy="135" r="16" fill="#26374b" stroke="#71879f"/>
    {[[307,68,playstation?'△':'Y','#ffd200'],[331,92,playstation?'○':'B','#ff8799'],[283,92,playstation?'□':'X','#49c9ff'],[307,116,playstation?'×':'A','#9ee8c3']].map(([x,y,label,color]) => <g key={String(label)}><circle cx={x} cy={y} r="11" fill="#111c2b" stroke="#65768c"/><text x={x} y={Number(y)+4} textAnchor="middle" fill={String(color)} fontSize="12" fontFamily="sans-serif" fontWeight="700">{label}</text></g>)}
    <path d="M189 118 h42" stroke="#19c3ff" strokeWidth="3" strokeLinecap="round" opacity=".8"/>
    <text x="126" y="19" textAnchor="middle" fill="#aabbd0" fontSize="10" fontFamily="sans-serif">{playstation?'L2':'LT'}</text>
    <text x="294" y="19" textAnchor="middle" fill="#aabbd0" fontSize="10" fontFamily="sans-serif">{playstation?'R2':'RT'}</text>
  </svg>
}

export function ControllerSettings() {
  const connected = useStore(controllerStore, s => s.connected)
  const [platform, setPlatform] = useState<'xbox' | 'playstation'>('xbox')
  const ps = platform === 'playstation'
  return <div className="controller-page">
    <div className="controller-page__heading">
      <div><span className="eyebrow">Your driving setup</span><h3>Take the wheel.</h3></div>
      <span className={`controller-page__status${connected ? ' is-connected' : ''}`} role="status"><i/>{connected ? 'Connected' : 'Not connected'}</span>
    </div>
    <div className="controller-page__hero">
      <div className="controller-page__platform" role="group" aria-label="Controller button labels">
        <button aria-pressed={!ps} onClick={() => setPlatform('xbox')}>Xbox</button>
        <button aria-pressed={ps} onClick={() => setPlatform('playstation')}>PlayStation</button>
      </div>
      <ControllerArt playstation={ps}/>
      <span className="controller-page__caption">{connected ? 'Ready for the starting grid' : 'USB or Bluetooth · Standard controllers'}</span>
    </div>
    {!connected && <div className="controller-page__connect">
      <div><b>01</b><span><strong>Connect your controller</strong><small>Plug in USB or pair in your device’s Bluetooth settings.</small></span></div>
      <div><b>02</b><span><strong>Press any button</strong><small>Keep this game focused. We’ll detect it automatically.</small></span></div>
    </div>}
    <details className="controller-page__guide" key={connected ? 'ready' : 'setup'} open={connected || undefined}><summary><span>Button guide</span><small>{ps ? 'PlayStation' : 'Xbox'} controls</small></summary>
    <div className="controller-page__section"><span className="eyebrow">On the track</span><span>Analog steering & triggers</span></div>
    <dl className="controller-page__bindings">{bindings.map(([action, xbox, playstation]) => <div key={action}><dt>{action}</dt><dd>{ps ? playstation : xbox}</dd></div>)}</dl>
    <div className="controller-page__menu"><span><b>{ps ? '×' : 'A'}</b> Select / skip intro</span><span><b>{ps ? '○' : 'B'}</b> Back</span><span>Stick / D-pad to navigate</span></div>
    </details>
    {!connected && <details className="controller-page__help"><summary>Controller not showing up?</summary><p>Reconnect it, click inside the game, then press a button. Your browser must support standard gamepad mappings. Pair Bluetooth controllers in your device settings first; the game cannot pair them for you.</p></details>}
  </div>
}
