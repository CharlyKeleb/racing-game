import { useRef } from 'react'
import { useGameInstance } from './GameContext'

/** Radians of orbit per pixel dragged, metres of camera height per pixel. */
const YAW_PER_PX = 0.0085
const HEIGHT_PER_PX = 0.012

/**
 * Full-screen layer behind the menu / garage panels: orbit the car.
 *  - drag (mouse or one finger): spin 360° around it, and up/down to change height
 *  - pinch (two fingers) or scroll wheel: zoom
 *  - flick and let go: it keeps turning and slows down
 */
export function OrbitLayer() {
  const game = useGameInstance()
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<number | null>(null)

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  return (
    <div
      className="drag-layer"
      aria-label="Drag to look around the car"
      onPointerDown={(e) => {
        try {
          e.currentTarget.setPointerCapture(e.pointerId)
        } catch {
          // synthetic / already released pointer — moves still arrive while over the layer
        }
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        if (pointers.current.size === 2) pinch.current = spread()
      }}
      onPointerMove={(e) => {
        const p = pointers.current.get(e.pointerId)
        if (!p) return
        const dx = e.clientX - p.x
        const dy = e.clientY - p.y
        p.x = e.clientX
        p.y = e.clientY
        if (pointers.current.size >= 2) {
          const d = spread()
          if (pinch.current && d > 0) game?.zoomShowroom(pinch.current / d)
          pinch.current = d
        } else {
          game?.rotateShowroom(-dx * YAW_PER_PX, dy * HEIGHT_PER_PX)
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId)
        if (pointers.current.size < 2) pinch.current = null
        if (pointers.current.size === 0) game?.releaseShowroom()
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId)
        pinch.current = null
      }}
      onWheel={(e) => game?.zoomShowroom(Math.exp(e.deltaY * 0.0012))}
    />
  )
}
