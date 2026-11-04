import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { InputState } from '../input/InputManager'
import { TiltSteering, requestTiltPermission, tiltNeedsPermission, tiltSupported } from '../input/TiltSteering'
import { enterLandscapeFullscreen, keepScreenAwake } from '../engine/device'
import { useGameInstance } from './GameContext'
import { useGame } from './hooks'

const RELEASED: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, lookBack: false }

/**
 * On-screen controls for phones and tablets, in one of two layouts (Settings → Touch controls):
 *  - Tilt (default): turn the device like a wheel to steer, the throttle is on, hold the left
 *    half of the screen to brake and the right half for nitro. Nothing is drawn over the road:
 *    a hint shows for a few seconds at the start, and the halves are invisible.
 *  - Pad: drag on the left half to steer; throttle, brake, nitro and drift buttons on the right.
 * Every control captures its own pointer, so several fingers work at once.
 */
export function TouchControls({ online = false, onlineReset = false }: { online?: boolean; onlineReset?: boolean }) {
  const game = useGameInstance()
  const manual = useGame((s) => !online && s.settings.transmission === 'manual')
  const wanted = useGame((s) => s.settings.touchControls)
  // Tilt needs the sensor (and, on iOS, a tap to allow it); without either, the pad.
  const [tilt, setTilt] = useState<'off' | 'ask' | 'on'>(() => wanted !== 'tilt' || !tiltSupported() ? 'off' : tiltNeedsPermission() ? 'ask' : 'on')
  useEffect(() => { setTilt(wanted !== 'tilt' || !tiltSupported() ? 'off' : tiltNeedsPermission() ? 'ask' : 'on') }, [wanted])
  const tiltFailed = useCallback(() => setTilt('off'), [])

  useEffect(() => () => game?.setTouchInput(RELEASED), [game])
  useEffect(() => keepScreenAwake(), [])

  const top = (
    <div className="touch-top">
      {!online && <><button className="touch-icon" aria-label="Switch camera" onPointerDown={() => game?.triggerAction('camera')}>◉</button>
        <button className="touch-icon" aria-label="Reset car" onPointerDown={() => game?.triggerAction('reset')}>↺</button></>}
      {onlineReset && <button className="touch-icon" aria-label="Reset car" onPointerDown={() => game?.triggerAction('reset')}>↺</button>}
      <button className="touch-icon" aria-label={online ? 'Race menu' : 'Pause'} onPointerDown={() => game?.triggerAction('pause')}>❚❚</button>
    </div>
  )
  const gears = manual && <div className="touch-col touch-col--gears">
    <button className="touch-btn touch-btn--small" aria-label="Shift up" onPointerDown={() => game?.triggerAction('shiftUp')}>+</button>
    <button className="touch-btn touch-btn--small" aria-label="Shift down" onPointerDown={() => game?.triggerAction('shiftDown')}>−</button>
  </div>

  if (tilt !== 'off') return (
    <div className="touch touch--tilt" onContextMenu={(e) => e.preventDefault()}>
      {tilt === 'on'
        ? <TiltLayout onFail={tiltFailed} gears={gears} />
        : <button className="touch-enable" onClick={() => {
          void enterLandscapeFullscreen()
          void requestTiltPermission().then((ok) => setTilt(ok ? 'on' : 'off'))
        }}>
          <strong>Tap to enable tilt steering</strong>
          <span>Turn your phone like a wheel · hold left to brake · hold right for nitro</span>
        </button>}
      {top}
      <div className="touch-rotate" aria-hidden="true">Turn your phone sideways</div>
    </div>
  )

  return (
    <div className="touch" onContextMenu={(e) => e.preventDefault()} onPointerDown={() => void enterLandscapeFullscreen()}>
      <SteerPad onSteer={(steer) => game?.setTouchInput({ steer })} />
      <div className="touch-pedals">
        <div className="touch-col">
          <Hold className="touch-btn touch-btn--small" label="Look back" text="Rear" onChange={(lookBack) => game?.setTouchInput({ lookBack })} />
          <Hold className="touch-btn touch-btn--small" label="Drift" onChange={(v) => game?.setTouchInput({ handbrake: v })} />
          <Hold className="touch-btn touch-btn--brake" label="Brake" onChange={(v) => game?.setTouchInput({ brake: v ? 1 : 0 })} />
        </div>
        {gears}
        <div className="touch-col">
          <Hold className="touch-btn touch-btn--nitro" label="N₂O" onChange={(v) => game?.setTouchInput({ nitro: v })} />
          <Hold className="touch-btn touch-btn--gas" label="Gas" onChange={(v) => game?.setTouchInput({ throttle: v ? 1 : 0 })} />
        </div>
      </div>
      {top}
    </div>
  )
}

/** Tilt to steer, throttle on, hold left to brake, hold right for nitro. */
function TiltLayout({ onFail, gears }: { onFail: () => void; gears: ReactNode }) {
  const game = useGameInstance()
  const [hint, setHint] = useState(true)

  useEffect(() => {
    const t = new TiltSteering((s) => game?.setTouchInput({ steer: s }))
    t.start()
    game?.setTouchInput({ throttle: 1 })
    // No reading at all (sensor blocked, desktop browser with touch): fall back to the pad.
    const check = window.setTimeout(() => { if (!t.live) onFail() }, 2000)
    const fade = window.setTimeout(() => setHint(false), 4000)
    return () => { window.clearTimeout(check); window.clearTimeout(fade); t.stop(); game?.setTouchInput(RELEASED) }
  }, [game, onFail])

  const brake = (on: boolean) => {
    game?.setTouchInput({ brake: on ? 1 : 0, throttle: on ? 0 : 1 })
  }

  return <>
    <Zone side="left" label="Brake" onChange={brake} />
    <Zone side="right" label="Nitro" onChange={(nitro) => game?.setTouchInput({ nitro })} />
    <div className={hint ? 'touch-hint' : 'touch-hint is-gone'} aria-hidden="true">Tilt to steer · hold left to brake · hold right for nitro</div>
    {gears && <div className="touch-tilt-bar">{gears}</div>}
  </>
}

/** Half the screen, held: the brake on the left, nitro on the right. */
function Zone({ side, label, onChange }: { side: 'left' | 'right'; label: string; onChange: (pressed: boolean) => void }) {
  const [pressed, setPressed] = useState(false)
  const set = (v: boolean) => { setPressed(v); onChange(v) }
  return (
    <div
      className={`touch-zone touch-zone--${side}${pressed ? ' is-pressed' : ''}`}
      role="button"
      aria-label={label}
      aria-pressed={pressed}
      onPointerDown={(e) => { capture(e); set(true) }}
      onPointerUp={() => set(false)}
      onPointerCancel={() => set(false)}
      onLostPointerCapture={() => set(false)}
    />
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
