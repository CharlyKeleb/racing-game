import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { InputState } from '../input/InputManager'
import { useGameInstance } from './GameContext'

const RELEASED: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, lookBack: false }

/**
 * On-screen controls for phones and tablets.
 *  - Left half: analog steering pad — drag left/right of where you touched.
 *  - Right: throttle (big), brake, nitro, handbrake.
 * Every control captures its own pointer, so steering + throttle + nitro work
 * simultaneously with three fingers.
 */
export function TouchControls() {
  const game = useGameInstance()

  useEffect(() => () => game?.setTouchInput(RELEASED), [game])

  return (
    <div className="touch" onContextMenu={(e) => e.preventDefault()}>
      <SteerPad onSteer={(steer) => game?.setTouchInput({ steer })} />
      <div className="touch-pedals">
        <div className="touch-col">
          <Hold className="touch-btn touch-btn--small" label="Look back" text="Rear" onChange={(lookBack) => game?.setTouchInput({ lookBack })} />
          <Hold className="touch-btn touch-btn--small" label="Drift" onChange={(v) => game?.setTouchInput({ handbrake: v })} />
          <Hold className="touch-btn touch-btn--brake" label="Brake" onChange={(v) => game?.setTouchInput({ brake: v ? 1 : 0 })} />
        </div>
        <div className="touch-col">
          <Hold className="touch-btn touch-btn--nitro" label="N₂O" onChange={(v) => game?.setTouchInput({ nitro: v })} />
          <Hold className="touch-btn touch-btn--gas" label="Gas" onChange={(v) => game?.setTouchInput({ throttle: v ? 1 : 0 })} />
        </div>
      </div>
      <div className="touch-top">
        <button className="touch-icon" aria-label="Switch camera" onPointerDown={() => game?.triggerAction('camera')}>
          ◉
        </button>
        <button className="touch-icon" aria-label="Reset car" onPointerDown={() => game?.triggerAction('reset')}>
          ↺
        </button>
        <button className="touch-icon" aria-label="Pause" onPointerDown={() => game?.triggerAction('pause')}>
          ❚❚
        </button>
      </div>
    </div>
  )
}

/** Keep receiving moves/ups after the finger slides off; never let a capture failure kill the control. */
function capture(e: ReactPointerEvent<HTMLElement>): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId)
  } catch {
    // pointer already released (or synthetic) — events still arrive while over the element
  }
}

/** Press-and-hold button that reports pressed/released. */
function Hold({ className, label, text, onChange }: { className: string; label: string; text?: string; onChange: (pressed: boolean) => void }) {
  const [pressed, setPressed] = useState(false)
  const set = (v: boolean) => {
    setPressed(v)
    onChange(v)
  }
  return (
    <div
      className={pressed ? `${className} is-pressed` : className}
      role="button"
      aria-label={label}
      aria-pressed={pressed}
      onPointerDown={(e) => {
        capture(e)
        set(true)
      }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
    >
      {text ?? label}
    </div>
  )
}

/** Analog steering: the touch-down point is centre; ±40% of the pad width is full lock. */
function SteerPad({ onSteer }: { onSteer: (steer: number) => void }) {
  const origin = useRef<number | null>(null)
  const [steer, setSteer] = useState(0)

  const update = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (origin.current === null) return
    const width = e.currentTarget.clientWidth
    const raw = (e.clientX - origin.current) / (width * 0.4)
    const s = Math.max(-1, Math.min(1, Math.abs(raw) < 0.06 ? 0 : raw))
    setSteer(s)
    onSteer(s)
  }
  const release = () => {
    origin.current = null
    setSteer(0)
    onSteer(0)
  }

  return (
    <div
      className="touch-steer"
      role="slider"
      aria-label="Steering"
      aria-valuemin={-1}
      aria-valuemax={1}
      aria-valuenow={steer}
      onPointerDown={(e) => {
        capture(e)
        origin.current = e.clientX
      }}
      onPointerMove={update}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <div className="touch-steer__track">
        <div className="touch-steer__knob" style={{ transform: `translateX(${steer * 100}%)` }} />
      </div>
      <span className="eyebrow">Drag to steer</span>
    </div>
  )
}
