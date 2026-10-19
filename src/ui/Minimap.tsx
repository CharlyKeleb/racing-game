import { minimapRoadPath } from '../world/MinimapRoads'
import { minimapRasterUrl } from './minimapRaster'
import { useId, useMemo } from 'react'
import { useGame, useTelemetry } from './hooks'

/** viewBox is 100×100; the car sits below centre so more of the road ahead shows. */
const CAR_X = 50
const CAR_Y = 62
/** Meters of world per viewBox unit: ~520 m across. */
const SCALE = 100 / 520

/**
 * Heading-up road map in a circular instrument, with dimmed surface context.
 * It turns with the car, so left on screen is left at the wheel. Zoomed in on the car, with the road
 * ahead lit cyan and the distance left to the finish underneath. Passed sections
 * return to the pale road colour as lap progress advances.
 */
export function Minimap() {
  const id = useId().replace(/:/g, '')
  const drift = useGame(s => s.settings.mode === 'drift')
  const gate = useTelemetry(s=>s.driftGate)
  const opponents = useTelemetry((s) => s.opponents)
  const data = useGame((s) => s.minimap)
  const carX = useTelemetry((s) => s.carX)
  const carZ = useTelemetry((s) => s.carZ)
  const heading = useTelemetry((s) => s.heading)
  const index = useTelemetry((s) => s.trackIndex)
  const distanceLeft = useTelemetry((s) => s.distanceLeft)

  const coverage = data?.overview
  const overview = useMemo(() => coverage ? minimapRasterUrl(coverage) : '', [coverage])
  const roads = useMemo(() => coverage ? minimapRoadPath(coverage) : '', [coverage])

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
    const start = Math.max(0, Math.min(pts.length - 1, index))
    // Keep all remaining points through the finish, without wrapping into passed road.
    let d = ''
    for (let k = start; k <= pts.length; k++) {
      const [x, z] = pts[k % pts.length]
      d += `${k === start ? 'M' : 'L'}${x.toFixed(1)},${z.toFixed(1)}`
    }
    return d
  }, [data, index])

  if (!outline) return null
  // Rotate the world so the car's forward (sin h, cos h) in map XZ points up the screen.
  const rot = -90 - (Math.atan2(Math.cos(heading), Math.sin(heading)) * 180) / Math.PI
  const northAngle = rot * Math.PI / 180
  const world = `translate(${CAR_X} ${CAR_Y}) rotate(${rot.toFixed(2)}) scale(${SCALE}) translate(${(-carX).toFixed(2)} ${(-carZ).toFixed(2)})`

  return (
    <div className="minimap" aria-label="Track map">
      <svg viewBox="0 0 100 100" role="img" aria-label="Nearby roads and highlighted race route">
        <defs>
          <clipPath id={`${id}-clip`}><circle cx="50" cy="50" r="47" /></clipPath>
          <radialGradient id={`${id}-shade`}>
            <stop offset="55%" stopColor="#060d15" stopOpacity="0" />
            <stop offset="100%" stopColor="#060d15" stopOpacity=".65" />
          </radialGradient>
        </defs>
        <circle className="minimap__disc" cx="50" cy="50" r="48" />
        <g clipPath={`url(#${id}-clip)`}>
        <g transform={world}>
          {overview && data?.overview && <image href={overview} x={data.overview.x} y={data.overview.z}
            width={data.overview.width * data.overview.cellSize} height={data.overview.height * data.overview.cellSize} /> }
          {roads && <path className="minimap__roads" d={roads} vectorEffect="non-scaling-stroke" />}
          <path className="minimap__edge" d={outline.d} vectorEffect="non-scaling-stroke" />
          <path className="minimap__track" d={outline.d} vectorEffect="non-scaling-stroke" />
        </g>
        <circle cx="50" cy="50" r="47" fill={`url(#${id}-shade)`} />
        <g transform={world}>
          <path className="minimap__route" d={route} vectorEffect="non-scaling-stroke" />
          {opponents.map(o => <circle key={o.id} cx={o.x} cy={o.z} r={6} fill={['#27b8eb', '#ffd447', '#e64f67'][(o.id - 1) % 3]} stroke="#101820" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
          {drift && data?.gates.map(([x,z],i)=><circle key={i} cx={x} cy={z} r={i===(gate+1)%data.gates.length?8:4} fill={i===(gate+1)%data.gates.length?'#ffd447':'#24e7df'} opacity={i>gate||i===0?1:.25} />)}
          <line className="minimap__start" {...outline.start} vectorEffect="non-scaling-stroke" />
        </g>
        <g className="minimap__car" transform={`translate(${CAR_X} ${CAR_Y})`}>
          <circle r="3.7" />
          <path d="M0,-2.8 L2,2 L0,.9 L-2,2 Z" />
        </g>
        </g>
        <circle className="minimap__rim" cx="50" cy="50" r="48" />
        <text className="minimap__north" x={50 + Math.sin(northAngle) * 40} y={50 - Math.cos(northAngle) * 40} textAnchor="middle" dominantBaseline="central">N</text>
      </svg>
      <div className="minimap__dist mono">{drift ? `${(distanceLeft / 1000).toFixed(2)} KM / TO FINISH` : `${(distanceLeft / 1000).toFixed(2)} km`}</div>
    </div>
  )
}
