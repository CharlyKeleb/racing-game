import { memo } from 'react'

/**
 * Need for Speed-style instrument cluster: a big neon speed dial with the gear
 * in the hub and a digital readout, plus small RPM and N₂O dials beside it.
 * Pure SVG. Telemetry arrives at 20 Hz; needles ease (with a little
 * overshoot) between updates via CSS, ticks light up as the needle passes,
 * the gear pops on a shift, the tach flashes at the shift point, the N₂O dial
 * pulses while boosting, and every needle sweeps once on the countdown.
 */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** Point at `deg` clockwise from 12 o'clock around (c, c). */
function polar(c: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [c + r * Math.sin(a), c - r * Math.cos(a)]
}
function arc(c: number, r: number, from: number, to: number): string {
  const [x0, y0] = polar(c, r, from)
  const [x1, y1] = polar(c, r, to)
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
}

// ── Speed dial ─────────────────────────────────────────────────────────────

const SWEEP = 250
const START = -SWEEP / 2
const C = 100
const R_TICKS = 90
const R_LABELS = 66
const angleFor = (t: number) => START + SWEEP * clamp01(t)

export interface SpeedometerProps {
  speedKmh: number
  maxKmh: number
  gear: string
  /** Engine at the shift point: the gear flashes red. */
  shift: boolean
  nitro: boolean
  /** Needle sweep on the start countdown. */
  sweep: boolean
}

export function Speedometer({ speedKmh, maxKmh, gear, shift, nitro, sweep }: SpeedometerProps) {
  const t = speedKmh / maxKmh
  const needle = angleFor(t)
  const cls = `gauge gauge--speed${nitro ? ' gauge--nitro' : ''}${shift ? ' gauge--shift' : ''}${sweep ? ' gauge--sweep' : ''}`
  return (
    <div className={cls} role="img" aria-label={`${Math.round(speedKmh)} km/h, gear ${gear}`}>
      <svg viewBox="0 0 200 200">
        <SpeedFace maxKmh={maxKmh} />
        <SpeedTicks maxKmh={maxKmh} lit={Math.floor(speedKmh / 10)} />
        {/* Neon trail from zero up to the needle. */}
        <path className="gauge__trail" d={arc(C, R_TICKS + 4, START, angleFor(Math.max(t, 0.004)))} />
        <g className="gauge__sweep">
          <g className="gauge__needle" style={{ transform: `rotate(${needle}deg)` }}>
            <polygon points={`${C - 3},${C + 12} ${C - 0.8},${C - R_TICKS + 4} ${C + 0.8},${C - R_TICKS + 4} ${C + 3},${C + 12}`} />
          </g>
        </g>
        <circle className="gauge__hub" cx={C} cy={C} r={24} />
        <text key={gear} className="gauge__gear" x={C} y={C + 12} textAnchor="middle">
          {gear}
        </text>
        <rect className="gauge__lcd" x={C - 30} y={C + 44} width={60} height={26} rx={2} />
        <text className="gauge__speed" x={C} y={C + 64} textAnchor="middle">
          {Math.round(speedKmh)}
        </text>
        <text className="gauge__unit" x={C} y={C + 82} textAnchor="middle">
          km/h
        </text>
      </svg>
    </div>
  )
}

const SpeedFace = memo(function SpeedFace({ maxKmh }: { maxKmh: number }) {
  const labels = []
  for (let v = 0; v <= maxKmh; v += 40) {
    const [lx, ly] = polar(C, R_LABELS, angleFor(v / maxKmh))
    labels.push(
      <text key={v} className="gauge__num" x={lx} y={ly + 5} textAnchor="middle">
        {v}
      </text>,
    )
  }
  return (
    <g>
      <defs>
        <radialGradient id="gauge-face" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(4, 10, 22, 0.78)" />
          <stop offset="70%" stopColor="rgba(4, 10, 22, 0.5)" />
          <stop offset="100%" stopColor="rgba(4, 10, 22, 0)" />
        </radialGradient>
      </defs>
      <circle cx={C} cy={C} r={99} fill="url(#gauge-face)" />
      <path className="gauge__track" d={arc(C, R_TICKS + 4, START, START + SWEEP)} />
      {labels}
    </g>
  )
})

/** Ticks re-render only when the lit count changes (every 10 km/h). */
const SpeedTicks = memo(function SpeedTicks({ maxKmh, lit }: { maxKmh: number; lit: number }) {
  const ticks = []
  for (let v = 0, i = 0; v <= maxKmh; v += 10, i++) {
    const major = v % 20 === 0
    const a = angleFor(v / maxKmh)
    const [x0, y0] = polar(C, R_TICKS, a)
    const [x1, y1] = polar(C, R_TICKS - (major ? 12 : 6), a)
    const cls = `gauge__tick${major ? ' gauge__tick--major' : ''}${i <= lit ? ' is-lit' : ''}`
    ticks.push(<line key={v} className={cls} x1={x0} y1={y0} x2={x1} y2={y1} />)
  }
  return <g>{ticks}</g>
})

// ── Small dials (RPM, N₂O) ───────────────────────────────────────────────

const SC = 60
const S_SWEEP = 240
const S_START = -S_SWEEP / 2
const S_R = 50
const sAngle = (t: number) => S_START + S_SWEEP * clamp01(t)

function SmallNeedle({ t }: { t: number }) {
  return (
    <g className="gauge__sweep">
      <g className="gauge__needle" style={{ transform: `rotate(${sAngle(t)}deg)` }}>
        <polygon points={`${SC - 2},${SC + 8} ${SC - 0.6},${SC - S_R + 6} ${SC + 0.6},${SC - S_R + 6} ${SC + 2},${SC + 8}`} />
      </g>
    </g>
  )
}

export interface RpmGaugeProps {
  rpm: number
  redlineRpm: number
  shift: boolean
  sweep: boolean
}

export function RpmGauge({ rpm, redlineRpm, shift, sweep }: RpmGaugeProps) {
  const max = Math.ceil((redlineRpm + 500) / 1000) * 1000
  const cls = `gauge gauge--small gauge--rpm${shift ? ' gauge--shift' : ''}${sweep ? ' gauge--sweep' : ''}`
  return (
    <div className={cls} role="img" aria-label={`${Math.round(rpm)} rpm`}>
      <svg viewBox="0 0 120 120">
        <RpmFace max={max} redline={redlineRpm} lit={Math.floor(rpm / 500)} />
        <SmallNeedle t={rpm / max} />
        <circle className="gauge__hub gauge__hub--small" cx={SC} cy={SC} r={7} />
        <text className="gauge__label" x={SC} y={SC + 30} textAnchor="middle">
          RPM
        </text>
        <text className="gauge__sublabel" x={SC} y={SC + 39} textAnchor="middle">
          ×1000
        </text>
      </svg>
    </div>
  )
}

const RpmFace = memo(function RpmFace({ max, redline, lit }: { max: number; redline: number; lit: number }) {
  const out = []
  for (let r = 0, i = 0; r <= max; r += 500, i++) {
    const major = r % 1000 === 0
    const a = sAngle(r / max)
    const [x0, y0] = polar(SC, S_R, a)
    const [x1, y1] = polar(SC, S_R - (major ? 8 : 4), a)
    const red = r >= redline
    const cls = `gauge__tick${major ? ' gauge__tick--major' : ''}${red ? ' gauge__tick--red' : ''}${i <= lit ? ' is-lit' : ''}`
    out.push(<line key={r} className={cls} x1={x0} y1={y0} x2={x1} y2={y1} />)
    if (major) {
      const [lx, ly] = polar(SC, S_R - 16, a)
      out.push(
        <text key={`l${r}`} className={`gauge__num gauge__num--small${red ? ' gauge__num--red' : ''}`} x={lx} y={ly + 3.5} textAnchor="middle">
          {r / 1000}
        </text>,
      )
    }
  }
  return (
    <g>
      <circle cx={SC} cy={SC} r={59} className="gauge__small-face" />
      <path className="gauge__redzone" d={arc(SC, S_R + 3, sAngle(redline / max), S_START + S_SWEEP)} />
      {out}
    </g>
  )
})

export interface NitroGaugeProps {
  /** Tank, 0..1. */
  level: number
  active: boolean
  ready: boolean
  sweep: boolean
}

export function NitroGauge({ level, active, ready, sweep }: NitroGaugeProps) {
  const state = active ? ' gauge--nitro-active' : ready ? ' gauge--nitro-ready' : ''
  return (
    <div className={`gauge gauge--small gauge--n2o${state}${sweep ? ' gauge--sweep' : ''}`} role="img" aria-label={`Nitro ${Math.round(level * 100)}%`}>
      <svg viewBox="0 0 120 120">
        <NitroFace />
        <path className="gauge__n2o-fill" d={arc(SC, S_R - 2, S_START, sAngle(Math.max(level, 0.004)))} />
        <SmallNeedle t={level} />
        <circle className="gauge__hub gauge__hub--small" cx={SC} cy={SC} r={7} />
        <text className="gauge__label" x={SC} y={SC + 32} textAnchor="middle">
          N₂O
        </text>
      </svg>
      {ready && !active && <kbd className="gauge__hint">Shift</kbd>}
    </div>
  )
}

const NitroFace = memo(function NitroFace() {
  const ticks = []
  for (let k = 0; k <= 8; k++) {
    const a = sAngle(k / 8)
    const [x0, y0] = polar(SC, S_R + 4, a)
    const [x1, y1] = polar(SC, S_R + (k % 4 === 0 ? -2 : 1), a)
    ticks.push(<line key={k} className="gauge__tick gauge__tick--n2o" x1={x0} y1={y0} x2={x1} y2={y1} />)
  }
  const [ex, ey] = polar(SC, S_R - 16, S_START)
  const [fx, fy] = polar(SC, S_R - 16, S_START + S_SWEEP)
  return (
    <g>
      <circle cx={SC} cy={SC} r={59} className="gauge__small-face" />
      <path className="gauge__n2o-track" d={arc(SC, S_R - 2, S_START, S_START + S_SWEEP)} />
      {ticks}
      <text className="gauge__num gauge__num--small" x={ex + 4} y={ey + 4} textAnchor="middle">
        E
      </text>
      <text className="gauge__num gauge__num--small" x={fx - 4} y={fy + 4} textAnchor="middle">
        F
      </text>
    </g>
  )
})
