/**
 * Merges keyboard and gamepad into one device-agnostic InputState.
 * Gameplay code only ever reads InputState — never raw devices — so touch
 * controls and replays/AI can feed the same struct later.
 */

export interface InputState {
  /** 0..1 */
  throttle: number
  /** 0..1 */
  brake: number
  /** -1 (left) .. 1 (right) */
  steer: number
  /** Omitted by AI/replays for the existing analog steering response. */
  steerSource?: 'keyboard' | 'analog'
  handbrake: boolean
  /** Nitro boost held. */
  nitro: boolean
  /** Temporary rear-facing camera while held; omitted by AI/replays. */
  lookBack?: boolean
}

/** Edge-triggered actions, consumed once per press. */
export type InputAction = 'pause' | 'reset' | 'camera' | 'skip' | 'restart'

const KEY_ACTIONS: Record<string, InputAction> = {
  Enter: 'skip',
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'reset',
  KeyC: 'camera',
  /** Time Trial quick restart / Free Roam back to the start. */
  KeyT: 'restart',
}

const GAMEPAD_DEADZONE = 0.12
/** Standard mapping button indices. */
const PAD = { A: 0, B: 1, X: 2, Y: 3, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, R3: 11 } as const

export class InputManager {
  readonly state: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
  private steerSource: 'keyboard' | 'analog' = 'keyboard'
  private readonly keys = new Set<string>()
  private readonly pending = new Set<InputAction>()
  private readonly prevPadButtons: boolean[] = []
  /** On-screen touch controls, merged with keyboard and gamepad every poll. */
  private readonly touch: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  /** Call once per fixed tick before gameplay reads `state`. */
  poll(): void {
    const k = this.keys
    let throttle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0
    let brake = k.has('KeyS') || k.has('ArrowDown') ? 1 : 0
    const right = k.has('KeyD') || k.has('ArrowRight')
    const left = k.has('KeyA') || k.has('ArrowLeft')
    let steer = (right ? 1 : 0) - (left ? 1 : 0)
    if (left || right) this.steerSource = 'keyboard'
    let handbrake = k.has('Space')
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight')
    let lookBack = k.has('KeyB')

    const pad = navigator.getGamepads?.().find((p) => p?.connected)
    if (pad) {
      const axis = pad.axes[0] ?? 0
      if (Math.abs(axis) > GAMEPAD_DEADZONE) {
        steer = axis
        this.steerSource = 'analog'
      }
      throttle = Math.max(throttle, pad.buttons[PAD.RT]?.value ?? 0)
      brake = Math.max(brake, pad.buttons[PAD.LT]?.value ?? 0)
      handbrake ||= !!pad.buttons[PAD.A]?.pressed
      nitro ||= !!pad.buttons[PAD.X]?.pressed || !!pad.buttons[PAD.RB]?.pressed
      lookBack ||= !!pad.buttons[PAD.R3]?.pressed
      this.edge(pad, PAD.A, 'skip')
      this.edge(pad, PAD.START, 'pause')
      this.edge(pad, PAD.Y, 'camera')
      this.edge(pad, PAD.B, 'reset')
      this.edge(pad, PAD.BACK, 'restart')
    }

    const t = this.touch
    throttle = Math.max(throttle, t.throttle)
    brake = Math.max(brake, t.brake)
    if (t.steer !== 0) {
      steer = t.steer
      this.steerSource = 'analog'
    }
    handbrake ||= t.handbrake
    nitro ||= t.nitro
    lookBack ||= !!t.lookBack

    this.state.throttle = throttle
    this.state.brake = brake
    this.state.steer = Math.max(-1, Math.min(1, steer))
    this.state.steerSource = this.steerSource
    this.state.handbrake = handbrake
    this.state.nitro = nitro
    this.state.lookBack = lookBack
  }

  /** Feed from the touch overlay (via Game.setTouchInput). */
  setTouch(patch: Partial<InputState>): void {
    Object.assign(this.touch, patch)
  }

  /** Queue an edge action from a UI button (pause, reset, camera). */
  trigger(action: InputAction): void {
    this.pending.add(action)
  }

  /** Returns true once per press. */
  consume(action: InputAction): boolean {
    return this.pending.delete(action)
  }

  private edge(pad: Gamepad, index: number, action: InputAction): void {
    const pressed = !!pad.buttons[index]?.pressed
    if (pressed && !this.prevPadButtons[index]) this.pending.add(action)
    this.prevPadButtons[index] = pressed
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return
    this.keys.add(e.code)
    const action = KEY_ACTIONS[e.code]
    if (action) this.pending.add(action)
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)
  }

  private onBlur = (): void => {
    this.keys.clear()
    Object.assign(this.touch, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, lookBack: false })
    this.state.lookBack = false
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }
}
