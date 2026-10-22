import { useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { controllerStore } from '../stores/controllerStore'
import { PAD, readGamepad, stick } from '../input/gamepad'

type Platform = 'xbox' | 'playstation'
type Mode = 'drive' | 'menu'
type Control = 'LT' | 'LB' | 'BACK' | 'LSTICK' | 'DPAD' | 'RT' | 'RB' | 'START' | 'Y' | 'B' | 'X' | 'A' | 'RSTICK'

/** Live pad snapshot, quantised so the page only re-renders when something visibly moves. */
interface Live { id: string; buttons: boolean[]; lt: number; rt: number; lx: number; ly: number; rx: number; ry: number }
const IDLE: Live = { id: '', buttons: [], lt: 0, rt: 0, lx: 0, ly: 0, rx: 0, ry: 0 }

const LABELS: Record<Platform, Record<Control, string>> = {
  xbox: { LT: 'LT', LB: 'LB', BACK: 'View', LSTICK: 'L', DPAD: 'D-pad', RT: 'RT', RB: 'RB', START: 'Menu', Y: 'Y', B: 'B', X: 'X', A: 'A', RSTICK: 'R3' },
  playstation: { LT: 'L2', LB: 'L1', BACK: 'Create', LSTICK: 'L', DPAD: 'D-pad', RT: 'R2', RB: 'R1', START: 'Options', Y: '△', B: '○', X: '□', A: '×', RSTICK: 'R3' },
}
const FACE: Record<Platform, Partial<Record<Control, string>>> = {
  xbox: { Y: '#ffd23f', B: '#ff5d6c', X: '#3fa9ff', A: '#5fe08f' },
  playstation: { Y: '#3fd8b8', B: '#ff6b7a', X: '#f08ad8', A: '#7aa8ff' },
}

/** What every control does, per context. `null` = unused there (drawn dim). Mirrors InputManager and ControllerNavigation. */
const ACTIONS: Record<Mode, Record<Control, [string, string] | null>> = {
  drive: {
    LT: ['Brake', 'Analog. Hold at a stop to reverse.'],
    LB: null,
    BACK: ['Restart', 'Time Trial restart; back to the start in Free Roam.'],
    LSTICK: ['Steer', 'Analog, with a 12% deadzone so a resting stick never pulls.'],
    DPAD: ['Shift gear', '↑ / ↓ shift up and down with the manual gearbox.'],
    RT: ['Throttle', 'Analog. Feather it to hold a drift angle.'],
    RB: ['Nitro', 'Same as X. Tap again on the cue for a perfect boost.'],
    START: ['Pause', 'Pause or resume the race.'],
    Y: ['Camera', 'Cycle chase, far chase and cockpit views.'],
    B: ['Reset car', 'Back on the road if you’re stuck or upside down.'],
    X: ['Nitro', 'Hold to burn the boost tank.'],
    A: ['Handbrake', 'Tap while turning to kick the car into a drift.'],
    RSTICK: ['Look back', 'Hold R3 for the rear view.'],
  },
  menu: {
    LT: null,
    LB: ['Prev tab', 'Play, Cars and Garage tabs in the hub.'],
    BACK: null,
    LSTICK: ['Navigate', 'Moves focus around the screen.'],
    DPAD: ['Navigate', 'Moves focus. ← / → nudge a focused slider.'],
    RT: null,
    RB: ['Next tab', 'Play, Cars and Garage tabs in the hub.'],
    START: ['Resume', 'Close the pause menu.'],
    Y: null,
    B: ['Back', 'Closes dialogs and steps back a screen.'],
    X: null,
    A: ['Select', 'Presses the focused button. Skips intros.'],
    RSTICK: null,
  },
}

type Callout = { id: Control; side: 'l' | 'r'; y: number; at: [number, number] }
type Point = [number, number]

/**
 * Each platform's pad is drawn to its own shape: the Xbox pad's offset sticks
 * with the D-pad low, the DualSense's touchpad, symmetric low sticks and
 * two-tone shell. Callout rows: label side and y, plus where the leader line lands.
 */
const LAYOUTS: Record<Platform, { callouts: Callout[]; body: string; lstick: Point; rstick: Point; dpad: Point; face: Point; back: Point; start: Point }> = {
  xbox: {
    body: 'M196 66 C230 58 268 62 300 62 C332 62 370 58 404 66 C430 73 444 98 455 140 C466 184 480 228 458 242 C436 257 414 240 396 218 C384 203 368 196 348 196 L252 196 C232 196 216 203 204 218 C186 240 164 257 142 242 C120 228 134 184 145 140 C156 98 170 73 196 66 Z',
    lstick: [230, 118], rstick: [348, 170], dpad: [252, 170], face: [385, 114], back: [268, 104], start: [332, 104],
    callouts: [
      { id: 'LT', side: 'l', y: 30, at: [214, 38] },
      { id: 'LB', side: 'l', y: 62, at: [206, 64] },
      { id: 'BACK', side: 'l', y: 94, at: [268, 104] },
      { id: 'LSTICK', side: 'l', y: 132, at: [214, 122] },
      { id: 'DPAD', side: 'l', y: 196, at: [240, 182] },
      { id: 'RT', side: 'r', y: 30, at: [386, 38] },
      { id: 'RB', side: 'r', y: 56, at: [394, 64] },
      { id: 'START', side: 'r', y: 82, at: [332, 104] },
      { id: 'Y', side: 'r', y: 106, at: [396, 90] },
      { id: 'B', side: 'r', y: 130, at: [420, 114] },
      { id: 'X', side: 'r', y: 154, at: [361, 125] },
      { id: 'A', side: 'r', y: 178, at: [396, 140] },
      { id: 'RSTICK', side: 'r', y: 214, at: [364, 184] },
    ],
  },
  playstation: {
    body: 'M188 64 C226 58 266 60 300 60 C334 60 374 58 412 64 C440 69 454 94 463 136 C475 186 488 230 464 245 C442 258 421 238 405 214 C393 197 378 192 360 192 L240 192 C222 192 207 197 195 214 C179 238 158 258 136 245 C112 230 125 186 137 136 C146 94 160 69 188 64 Z',
    lstick: [262, 160], rstick: [338, 160], dpad: [214, 110], face: [386, 110], back: [238, 78], start: [362, 78],
    callouts: [
      { id: 'LT', side: 'l', y: 30, at: [214, 38] },
      { id: 'LB', side: 'l', y: 58, at: [206, 64] },
      { id: 'BACK', side: 'l', y: 84, at: [232, 78] },
      { id: 'DPAD', side: 'l', y: 118, at: [194, 112] },
      { id: 'LSTICK', side: 'l', y: 196, at: [252, 176] },
      { id: 'RT', side: 'r', y: 30, at: [386, 38] },
      { id: 'RB', side: 'r', y: 56, at: [394, 64] },
      { id: 'START', side: 'r', y: 80, at: [368, 78] },
      { id: 'Y', side: 'r', y: 104, at: [397, 86] },
      { id: 'B', side: 'r', y: 128, at: [421, 110] },
      { id: 'X', side: 'r', y: 152, at: [362, 121] },
      { id: 'A', side: 'r', y: 176, at: [397, 134] },
      { id: 'RSTICK', side: 'r', y: 214, at: [348, 176] },
    ],
  },
}

/** Which pad input lights each control up. */
const PRESS: Record<Control, (l: Live) => boolean> = {
  LT: l => l.lt > 0.05, RT: l => l.rt > 0.05,
  LB: l => !!l.buttons[PAD.LB], RB: l => !!l.buttons[PAD.RB],
  BACK: l => !!l.buttons[PAD.BACK], START: l => !!l.buttons[PAD.START],
  LSTICK: l => !!l.buttons[PAD.L3] || l.lx !== 0 || l.ly !== 0,
  RSTICK: l => !!l.buttons[PAD.R3],
  DPAD: l => !!(l.buttons[PAD.UP] || l.buttons[PAD.DOWN] || l.buttons[PAD.LEFT] || l.buttons[PAD.RIGHT]),
  Y: l => !!l.buttons[PAD.Y], B: l => !!l.buttons[PAD.B], X: l => !!l.buttons[PAD.X], A: l => !!l.buttons[PAD.A],
}

const q = (v: number) => Math.round(v * 50) / 50

function useLivePad(): Live {
  const [live, setLive] = useState<Live>(IDLE)
  useEffect(() => {
    let frame = 0, last = ''
    const tick = () => {
      const pad = readGamepad()
      const next: Live = pad ? {
        id: pad.id,
        buttons: pad.buttons.map(b => b.pressed),
        lt: q(pad.buttons[PAD.LT]?.value ?? 0), rt: q(pad.buttons[PAD.RT]?.value ?? 0),
        lx: q(stick(pad.axes[0])), ly: q(stick(pad.axes[1])), rx: q(stick(pad.axes[2])), ry: q(stick(pad.axes[3])),
      } : IDLE
      const key = JSON.stringify(next)
      if (key !== last) { last = key; setLive(next) }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])
  return live
}

/** Vendor 054c is Sony; browsers also report the names. */
const isPlayStation = (id: string) => /054c|dualsense|dualshock|playstation|wireless controller \(/i.test(id) && !/xbox|045e/i.test(id)
/** "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)" → "Xbox Wireless Controller". */
const padName = (id: string) => id.replace(/\s*\(.*\)\s*$/, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim() || 'Controller'

function ControllerArt({ platform, mode, live, focus, onFocus }: { platform: Platform; mode: Mode; live: Live; focus: Control | null; onFocus(c: Control | null): void }) {
  const labels = LABELS[platform], face = FACE[platform], actions = ACTIONS[mode], layout = LAYOUTS[platform]
  const ps = platform === 'playstation'
  const cls = (c: Control) => `pad-part${PRESS[c](live) ? ' is-on' : ''}${focus === c ? ' is-focus' : ''}${actions[c] ? '' : ' is-idle'}`
  const button = (c: Control, x: number, y: number) => <g className={cls(c)} style={{ ['--tone' as string]: face[c] }}>
    <circle cx={x} cy={y} r="11.5" className="pad-face"/>
    <text x={x} y={y + 4.2} textAnchor="middle" className="pad-face__glyph">{labels[c]}</text>
  </g>
  const thumb = (c: Control, [cx, cy]: Point, x: number, y: number) => <g className={cls(c)}>
    <circle cx={cx} cy={cy} r="24" className="pad-well"/>
    <circle cx={cx + x * 8} cy={cy + y * 8} r="16.5" className="pad-stick"/>
    <circle cx={cx + x * 8} cy={cy + y * 8} r="10.5" className="pad-stick__top"/>
  </g>
  const dir = (index: number) => live.buttons[index] ? 'pad-arrow is-on' : 'pad-arrow'
  const [dx, dy] = layout.dpad, [fx, fy] = layout.face

  return <svg className={`pad-art pad-art--${platform}`} viewBox="0 0 600 256" role="img" aria-label={`${ps ? 'DualSense' : 'Xbox'} controller layout for ${mode === 'drive' ? 'driving' : 'menus'}`}>
    <defs>
      <linearGradient id="pad-shell" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3a4a60"/><stop offset=".55" stopColor="#1d2939"/><stop offset="1" stopColor="#111a27"/></linearGradient>
      <linearGradient id="pad-shell-ps" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4f6fa"/><stop offset=".6" stopColor="#d5dbe4"/><stop offset="1" stopColor="#a9b3c1"/></linearGradient>
      <linearGradient id="pad-core-ps" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1d2330"/><stop offset="1" stopColor="#0b0e14"/></linearGradient>
      <linearGradient id="pad-rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a9bdd4"/><stop offset=".4" stopColor="#4c5f78"/><stop offset="1" stopColor="#1a2433"/></linearGradient>
      <radialGradient id="pad-sheen" cx=".5" cy=".1" r=".75"><stop offset="0" stopColor="#ffffff" stopOpacity=".16"/><stop offset="1" stopColor="#ffffff" stopOpacity="0"/></radialGradient>
      <clipPath id="pad-clip-lt"><rect x="190" y="24" width="48" height="24" rx="9"/></clipPath>
      <clipPath id="pad-clip-rt"><rect x="362" y="24" width="48" height="24" rx="9"/></clipPath>
    </defs>

    {layout.callouts.map(({ id, side, y, at }) => {
      const action = actions[id]
      const edge = side === 'l' ? 128 : 472
      const elbow = side === 'l' ? Math.min(at[0] - 16, 160) : Math.max(at[0] + 16, 440)
      return <g key={id} className={`pad-callout ${cls(id)}`} onPointerEnter={() => onFocus(id)} onPointerLeave={() => onFocus(null)}>
        <polyline points={`${at[0]},${at[1]} ${elbow},${y} ${edge},${y}`} className="pad-lead"/>
        <circle cx={at[0]} cy={at[1]} r="2.4" className="pad-dot"/>
        <rect x={side === 'l' ? 0 : edge} y={y - 11} width={128} height={22} className="pad-callout__hit"/>
        <text x={side === 'l' ? edge - 6 : edge + 6} y={y + 4} textAnchor={side === 'l' ? 'end' : 'start'} className="pad-callout__text">
          {side === 'l'
            ? <><tspan className="pad-callout__action">{action ? action[0] : '—'}</tspan><tspan dx="6" className="pad-callout__key">{labels[id]}</tspan></>
            : <><tspan className="pad-callout__key">{labels[id]}</tspan><tspan dx="6" className="pad-callout__action">{action ? action[0] : '—'}</tspan></>}
        </text>
      </g>
    })}

    <ellipse cx="300" cy="246" rx="154" ry="8" fill="#000" opacity=".4"/>
    {(['LT', 'RT'] as const).map(c => {
      const x = c === 'LT' ? 190 : 362, value = c === 'LT' ? live.lt : live.rt
      return <g key={c} className={cls(c)}>
        <rect x={x} y="24" width="48" height="24" rx="9" className="pad-trigger"/>
        <rect x={x} y={24 + 24 * (1 - value)} width="48" height={24 * value} clipPath={`url(#pad-clip-${c.toLowerCase()})`} className="pad-trigger__fill"/>
        <text x={x + 24} y="40" textAnchor="middle" className="pad-shoulder__glyph">{labels[c]}</text>
      </g>
    })}
    {(['LB', 'RB'] as const).map(c => <g key={c} className={cls(c)}>
      <path d={c === 'LB' ? 'M176 70 Q182 52 214 50 L250 50 Q255 58 248 63 L192 70 Z' : 'M424 70 Q418 52 386 50 L350 50 Q345 58 352 63 L408 70 Z'} className="pad-bumper"/>
      <text x={c === 'LB' ? 218 : 382} y="63" textAnchor="middle" className="pad-shoulder__glyph pad-shoulder__glyph--sm">{labels[c]}</text>
    </g>)}

    <path className="pad-body" d={layout.body}/>
    {ps ? <>
      {/* DualSense: black core between the grips, white touchpad edged by the light bar. */}
      <path d="M246 62 L354 62 C360 100 372 150 376 192 L224 192 C228 150 240 100 246 62 Z" fill="url(#pad-core-ps)"/>
      <path d="M248 62 L352 62 L348 120 Q300 128 252 120 Z" className="pad-touchpad"/>
      <path d="M248 64 L252 120 M352 64 L348 120" className="pad-lightbar"/>
      <circle cx="300" cy="178" r="7" className="pad-home"/>
      <path d="M297 175 v7 M297 175 q6 0 6 3 q0 3 -6 3" className="pad-home__ps"/>
      <rect x="294" y="188" width="12" height="3" rx="1.5" className="pad-mute"/>
    </> : <>
      <path d="M196 66 C230 58 268 62 300 62 C332 62 370 58 404 66 C430 73 444 98 455 140 L145 140 C156 98 170 73 196 66 Z" fill="url(#pad-sheen)" pointerEvents="none"/>
      <circle cx="300" cy="84" r="10" className="pad-home"/>
      <path d="M294 84 l6 -5 l6 5 l-6 5 Z" className="pad-home__mark"/>
    </>}

    <g className={cls('BACK')}><rect x={layout.back[0] - 9} y={layout.back[1] - (ps ? 7 : 5.5)} width={ps ? 8 : 18} height={ps ? 14 : 11} rx={ps ? 4 : 5.5} className="pad-small"/></g>
    <g className={cls('START')}><rect x={layout.start[0] - (ps ? -1 : 9)} y={layout.start[1] - (ps ? 7 : 5.5)} width={ps ? 8 : 18} height={ps ? 14 : 11} rx={ps ? 4 : 5.5} className="pad-small"/></g>

    {thumb('LSTICK', layout.lstick, live.lx, live.ly)}
    {thumb('RSTICK', layout.rstick, live.rx, live.ry)}

    <g className={cls('DPAD')} transform={`translate(${dx - 252} ${dy - 170})`}>
      <circle cx="252" cy="170" r="24" className="pad-well"/>
      <path d="M245 151 h14 v12 h12 v14 h-12 v12 h-14 v-12 h-12 v-14 h12 Z" className="pad-dpad"/>
      <path d="M252 154 l-4 6 h8 Z" className={dir(PAD.UP)}/>
      <path d="M252 186 l-4 -6 h8 Z" className={dir(PAD.DOWN)}/>
      <path d="M236 170 l6 -4 v8 Z" className={dir(PAD.LEFT)}/>
      <path d="M268 170 l-6 -4 v8 Z" className={dir(PAD.RIGHT)}/>
    </g>

    <circle cx={fx} cy={fy} r="38" className="pad-well pad-well--face"/>
    {button('Y', fx, fy - 24)}
    {button('X', fx - 24, fy)}
    {button('B', fx + 24, fy)}
    {button('A', fx, fy + 24)}
  </svg>
}

/** One labelled meter; `center` draws a -1..1 bar from the middle. */
function Meter({ label, value, center, tone }: { label: string; value: number; center?: boolean; tone: string }) {
  const style = center
    ? { left: `${50 + Math.min(0, value) * 50}%`, width: `${Math.abs(value) * 50}%` }
    : { left: 0, width: `${value * 100}%` }
  return <div className="pad-meter" style={{ ['--tone' as string]: tone }}>
    <span className="pad-meter__label">{label}</span>
    <span className={`pad-meter__track${center ? ' pad-meter__track--center' : ''}`}><i style={style}/></span>
    <b>{center && value !== 0 ? (value < 0 ? 'L ' : 'R ') : ''}{Math.round(Math.abs(value) * 100)}%</b>
  </div>
}

const TIPS: [string, string][] = [
  ['Feather the trigger', 'RT is analog. Ease off mid-drift to tighten the line; floor it to swing the tail wider.'],
  ['Perfect boost', 'Tap nitro again when the gauge flashes for a stronger, longer burn.'],
  ['Launch off the line', 'Hold LT on the grid, keep the revs in the green band and let go when the lights go out.'],
  ['Burnout', 'Stopped, hold brake and floor the throttle. Steer to swing the tail round.'],
]

export function ControllerSettings() {
  const connected = useStore(controllerStore, s => s.connected)
  const live = useLivePad()
  const [picked, setPlatform] = useState<Platform | null>(null)
  const [mode, setMode] = useState<Mode>('drive')
  const [focus, setFocus] = useState<Control | null>(null)
  // Follow the pad that's plugged in until the toggle picks a layout.
  const platform: Platform = picked ?? (isPlayStation(live.id) ? 'playstation' : 'xbox')

  const labels = LABELS[platform]
  const pressed = LAYOUTS[platform].callouts.find(c => PRESS[c.id](live))?.id
  const shown = focus ?? pressed ?? null
  const detail = shown && ACTIONS[mode][shown]
  const ps = platform === 'playstation'
  const tips = TIPS.map(([title, body]) => [title, ps ? body.replace(/\bRT\b/g, 'R2').replace(/\bLT\b/g, 'L2') : body] as const)

  return <div className="pad-page">
    <div className="pad-page__heading">
      <div>
        <span className="eyebrow">Controller</span>
        <h3>Take the wheel.</h3>
      </div>
      <span className={`pad-status${connected ? ' is-connected' : ''}`} role="status">
        <i/>{connected ? padName(live.id) : 'No controller'}
      </span>
    </div>

    <div className={`pad-stage${connected ? ' is-live' : ''}`}>
      <div className="pad-stage__bar">
        <div className="pad-toggle" role="group" aria-label="Show bindings for">
          <button aria-pressed={mode === 'drive'} onClick={() => setMode('drive')}>On track</button>
          <button aria-pressed={mode === 'menu'} onClick={() => setMode('menu')}>Menus</button>
        </div>
        <div className="pad-toggle" role="group" aria-label="Button labels">
          <button aria-pressed={!ps} onClick={() => setPlatform('xbox')}>Xbox</button>
          <button aria-pressed={ps} onClick={() => setPlatform('playstation')}>PlayStation</button>
        </div>
      </div>
      <ControllerArt platform={platform} mode={mode} live={live} focus={focus} onFocus={setFocus}/>
      <div className="pad-stage__readout" aria-live="polite">
        {detail ? <><span className="pad-chip">{labels[shown]}</span><strong>{detail[0]}</strong><small>{detail[1]}</small></>
          : shown ? <><span className="pad-chip">{labels[shown]}</span><small>Not used {mode === 'drive' ? 'on track' : 'in menus'}.</small></>
          : <small>{connected ? 'Press any button to test it, or hover a label for details.' : 'Hover a label for details. Connect a controller to test it live.'}</small>}
      </div>
    </div>

    {connected ? <div className="pad-live">
      <span className="eyebrow">Live input</span>
      <Meter label="Steer" value={live.lx} center tone="var(--accent-2)"/>
      <Meter label={`Throttle · ${labels.RT}`} value={live.rt} tone="#5fe08f"/>
      <Meter label={`Brake · ${labels.LT}`} value={live.lt} tone="#ff5d6c"/>
      <p>Steering ignores the first 12% of stick travel, then scales smoothly to full lock.</p>
    </div> : <ol className="pad-connect">
      <li><b>01</b><span><strong>Plug in or pair</strong><small>USB, or pair Bluetooth in your device’s settings first.</small></span></li>
      <li><b>02</b><span><strong>Press any button</strong><small>With this tab focused. Browsers hide pads until you do.</small></span></li>
      <li><b>03</b><span><strong>Drive</strong><small>Xbox, PlayStation and other standard pads work out of the box.</small></span></li>
    </ol>}

    <div className="pad-tips">
      <span className="eyebrow">Driver tips</span>
      <div>{tips.map(([title, body]) => <article key={title}><strong>{title}</strong><small>{body}</small></article>)}</div>
    </div>

    {!connected && <details className="pad-help"><summary>Controller not showing up?</summary>
      <p>Reconnect it, click inside the game, then press a button. The browser must expose it with the standard gamepad mapping; Chrome, Edge, Firefox and Safari do for Xbox and PlayStation pads. The game can’t pair Bluetooth controllers for you.</p>
    </details>}
  </div>
}
