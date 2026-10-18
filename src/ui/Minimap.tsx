import { useMemo } from 'react'
import { useGame, useTelemetry } from './hooks'

/** viewBox is 100×100; the car sits below centre so more of the road ahead shows. */
const CAR_X = 50
const CAR_Y = 62
/** Meters of world per viewBox unit: ~520 m across. */
const SCALE = 100 / 520
/** Route highlight: this many centreline points ahead of the car (~4 m apart → ~480 m). */
const ROUTE_POINTS = 120

/**
 * Need for Speed-style map: no frame, heading-up (it turns with the car, so
 * left on screen is left at the wheel), zoomed in on the car, with the road
 * ahead lit cyan and the distance left to the finish underneath. The outline
 * path is built once per track; only the transform and the short route path
 * change at telemetry rate (20 Hz).
 */
export function Minimap() {
  const drift = useGame(s => s.settings.mode === 'drift')
  const opponents = useTelemetry((s) => s.opponents)
  const data = useGame((s) => s.minimap)
  const carX = useTelemetry((s) => s.carX)
  const carZ = useTelemetry((s) => s.carZ)
  const heading = useTelemetry((s) => s.heading)
  const index = useTelemetry((s) => s.trackIndex)
  const distanceLeft = useTelemetry((s) => s.distanceLeft)

  const outline = useMemo(() => {
    if (!data || data.points.length < 2) return null
    const pts = data.points
    const d = 'M' + pts.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join('L') + 'Z'
    // Start/finish: a short bar across the road at point 0.
    const [sx, sz] = pts[0]
    const [nx, nz] = pts[1]
    const l = Math.hypot(nx - sx, nz - sz) || 1
    const px = (-(nz - sz) / l) * 9
    const pz = ((nx - sx) / l) * 9
    return { d, start: { x1: sx - px, y1: sz - pz, x2: sx + px, y2: sz + pz } }
  }, [data])

  const route = useMemo(() => {
    if (!data || data.points.length < 2) return ''
    const pts = data.points
    const n = pts.length
    let d = ''
    for (let k = 0; k <= ROUTE_POINTS; k++) {
      const [x, z] = pts[(index + k) % n]
      d += `${k ? 'L' : 'M'}${x.toFixed(1)},${z.toFixed(1)}`
    }
    return d
  }, [data, index])

  if (!outline) return null
  // Rotate the world so the car's forward (sin h, cos h) in map XZ points up the screen.
  const rot = -90 - (Math.atan2(Math.cos(heading), Math.sin(heading)) * 180) / Math.PI
  const world = `translate(${CAR_X} ${CAR_Y}) rotate(${rot.toFixed(2)}) scale(${SCALE}) translate(${(-carX).toFixed(2)} ${(-carZ).toFixed(2)})`

  return (
    <div className="minimap" aria-label="Track map">
      <svg viewBox="0 0 100 100">
        <g transform={world}>
          <path className="minimap__edge" d={outline.d} vectorEffect="non-scaling-stroke" />
          <path className="minimap__track" d={outline.d} vectorEffect="non-scaling-stroke" />
          <path className="minimap__route" d={route} vectorEffect="non-scaling-stroke" />
          {opponents.map(o => <circle key={o.id} cx={o.x} cy={o.z} r={10} fill={['#27b8eb', '#ffd447', '#e64f67'][(o.id - 1) % 3]} stroke="#101820" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
          <line className="minimap__start" {...outline.start} vectorEffect="non-scaling-stroke" />
        </g>
        <g className="minimap__car" transform={`translate(${CAR_X} ${CAR_Y})`}>
          <circle r="5.2" />
          <path d="M0,-3.6 L2.6,2.6 L0,1.2 L-2.6,2.6 Z" />
        </g>
      </svg>
      <div className="minimap__dist mono">{drift ? 'DRIFT / OPEN SESSION' : `${(distanceLeft / 1000).toFixed(2)} km`}</div>
    </div>
  )
}
