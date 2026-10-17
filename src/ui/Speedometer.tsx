import { memo } from 'react'

/**
 * Analog instrument cluster: a speed dial with a sweeping needle, an inner
 * tachometer arc with a redline zone, and digital speed + gear in the hub.
 * Pure SVG; the needle eases between 20 Hz telemetry updates via CSS.
 */

const SWEEP = 260 // degrees, symmetric about 12 o'clock
const START = -SWEEP / 2
const C = 100 // centre of the 200×200 viewBox
const R_TICKS = 88
const R_LABELS = 68
const R_TACH = 52

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const angleFor = (t: number) => START + SWEEP * clamp01(t)
/** Point at `deg` clockwise from 12 o'clock. */
function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [C + r * Math.sin(a), C - r * Math.cos(a)]
}
function arc(r: number, from: number, to: number): string {
  const [x0, y0] = polar(r, from)
  const [x1, y1] = polar(r, to)
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
}

export interface SpeedometerProps {
  speedKmh: number
  maxKmh: number
  rpm: number
  redlineRpm: number
  gear: string
  nitro: boolean
}

export function Speedometer({ speedKmh, maxKmh, rpm, redlineRpm, gear, nitro }: SpeedometerProps) {
  const tachMax = Math.ceil((redlineRpm + 500) / 1000) * 1000
  const rpmT = rpm / tachMax
  const redT = redlineRpm / tachMax
  const inRedline = rpm >= redlineRpm * 0.97
  const needle = angleFor(speedKmh / maxKmh)

  return (
    <div className={`gauge${nitro ? ' gauge--nitro' : ''}${inRedline ? ' gauge--redline' : ''}`} role="img" aria-label={`${Math.round(speedKmh)} km/h, gear ${gear}`}>
      <svg viewBox="0 0 200 200">
        <Dial maxKmh={maxKmh} tachMax={tachMax} redT={redT} />
        {/* Tachometer: lit arc up to current rpm */}
        <path className="gauge__tach-fill" d={arc(R_TACH, START, angleFor(Math.max(rpmT, 0.002)))} />
        {/* Needle — rotated as a group so CSS can ease it */}
        <g className="gauge__needle" style={{ transform: `rotate(${needle}deg)` }}>
          <polygon points={`${C - 2.6},${C + 14} ${C - 0.9},${C - R_TICKS + 6} ${C + 0.9},${C - R_TICKS + 6} ${C + 2.6},${C + 14}`} />
        </g>
        <circle className="gauge__hub" cx={C} cy={C} r={30} />
        <text className="gauge__speed" x={C} y={C + 6} textAnchor="middle">
          {Math.round(speedKmh)}
        </text>
        <text className="gauge__unit" x={C} y={C + 18} textAnchor="middle">
          km/h
        </text>
        <rect className="gauge__gear-box" x={C - 13} y={C + 40} width={26} height={24} rx={2} />
        <text className="gauge__gear" x={C} y={C + 59} textAnchor="middle">
          {gear}
        </text>
      </svg>
    </div>
  )
}

/** Static face: bezel, tick marks, numerals, tach track and redline. Memoised — it never changes mid-race. */
const Dial = memo(function Dial({ maxKmh, tachMax, redT }: { maxKmh: number; tachMax: number; redT: number }) {
  const ticks = []
  for (let v = 0; v <= maxKmh; v += 10) {
    const major = v % 20 === 0
    const a = angleFor(v / maxKmh)
    const [x0, y0] = polar(R_TICKS, a)
    const [x1, y1] = polar(R_TICKS - (major ? 10 : 5), a)
    ticks.push(<line key={`t${v}`} className={major ? 'gauge__tick gauge__tick--major' : 'gauge__tick'} x1={x0} y1={y0} x2={x1} y2={y1} />)
    if (v % 40 === 0) {
      const [lx, ly] = polar(R_LABELS + 2, a)
      ticks.push(
        <text key={`l${v}`} className="gauge__num" x={lx} y={ly + 4} textAnchor="middle">
          {v}
        </text>,
      )
    }
  }
  const tachTicks = []
  for (let k = 0; k <= tachMax; k += 1000) {
    const a = angleFor(k / tachMax)
    const [x0, y0] = polar(R_TACH + 5, a)
    const [x1, y1] = polar(R_TACH - 5, a)
    tachTicks.push(<line key={`r${k}`} className="gauge__tach-tick" x1={x0} y1={y0} x2={x1} y2={y1} />)
  }
  return (
    <g>
      <circle className="gauge__bezel" cx={C} cy={C} r={97} />
      <circle className="gauge__face" cx={C} cy={C} r={93} />
      <path className="gauge__band" d={arc(R_TICKS - 1, START, START + SWEEP)} />
      {ticks}
      <path className="gauge__tach-track" d={arc(R_TACH, START, START + SWEEP)} />
      <path className="gauge__tach-red" d={arc(R_TACH, angleFor(redT), START + SWEEP)} />
      {tachTicks}
      <text className="gauge__tach-label" x={C} y={C - 34} textAnchor="middle">
        ×1000 rpm
      </text>
    </g>
  )
})
