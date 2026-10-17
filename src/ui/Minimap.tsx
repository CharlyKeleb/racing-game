import { useMemo } from 'react'
import { useGame, useTelemetry } from './hooks'

const SIZE = 100 // viewBox units; CSS sets the on-screen size
const PAD = 8

/**
 * North-up map of the whole circuit with the car's position and heading.
 * The outline is static (memoised); only the car marker moves, at telemetry
 * rate (20 Hz) with a short CSS transition so it glides.
 */
export function Minimap() {
  const data = useGame((s) => s.minimap)
  const carX = useTelemetry((s) => s.carX)
  const carZ = useTelemetry((s) => s.carZ)
  const heading = useTelemetry((s) => s.heading)

  const fit = useMemo(() => {
    if (!data || data.points.length < 2) return null
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
    for (const [x, z] of data.points) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z)
    }
    const scale = (SIZE - PAD * 2) / Math.max(x1 - x0, z1 - z0)
    // Centre the track in the square.
    const ox = PAD + (SIZE - PAD * 2 - (x1 - x0) * scale) / 2
    const oz = PAD + (SIZE - PAD * 2 - (z1 - z0) * scale) / 2
    const map = (x: number, z: number): [number, number] => [ox + (x - x0) * scale, oz + (z - z0) * scale]
    const path = data.points.map(([x, z]) => map(x, z).map((v) => v.toFixed(1)).join(',')).join(' ')
    // Start/finish: a short bar across the track at point 0.
    const [sx, sz] = map(...data.points[0])
    const [nx, nz] = map(...data.points[1])
    const a = Math.atan2(nz - sz, nx - sx)
    const startLine = { x1: sx - Math.sin(a) * 4, y1: sz + Math.cos(a) * 4, x2: sx + Math.sin(a) * 4, y2: sz - Math.cos(a) * 4 }
    return { map, path, startLine }
  }, [data])

  if (!fit) return null
  const [cx, cz] = fit.map(carX, carZ)
  // Marker points up at rest; world yaw 0 faces +Z, which is "down" on the map.
  const deg = 180 - (heading * 180) / Math.PI

  return (
    <div className="minimap" aria-label="Track map">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <polygon className="minimap__edge" points={fit.path} />
        <polygon className="minimap__track" points={fit.path} />
        <line className="minimap__start" {...fit.startLine} />
        {/* SVG transform attribute, not CSS `transform`: CSS px on SVG elements
            isn't mapped to viewBox units the same way in every browser (Safari),
            which put the marker off the track outline. At 20 Hz the step is
            under a pixel, so no transition is needed. */}
        <g className="minimap__car" transform={`translate(${cx.toFixed(2)} ${cz.toFixed(2)}) rotate(${deg.toFixed(1)})`}>
          <path d="M0,-5 L3.6,4 L0,2.2 L-3.6,4 Z" />
        </g>
      </svg>
    </div>
  )
}
