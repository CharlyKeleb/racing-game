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
  handbrake: boolean
  /** Nitro boost held. */
  nitro: boolean
}

/** Edge-triggered actions, consumed once per press. */
export type InputAction = 'pause' | 'reset' | 'camera'

const KEY_ACTIONS: Record<string, InputAction> = {
  Escape: 'pause',
  KeyP: 'pause',
  KeyR: 'reset',
  KeyC: 'camera',
}

const GAMEPAD_DEADZONE = 0.12
/** Standard mapping button indices. */
const PAD = { A: 0, B: 1, X: 2, Y: 3, RB: 5, LT: 6, RT: 7, START: 9 } as const

export class InputManager {
  readonly state: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false }
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
    let steer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0)
    let handbrake = k.has('Space')
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight')

    const pad = navigator.getGamepads?.().find((p) => p?.connected)
    if (pad) {
      const axis = pad.axes[0] ?? 0
      if (Math.abs(axis) > GAMEPAD_DEADZONE) steer = axis
      throttle = Math.max(throttle, pad.buttons[PAD.RT]?.value ?? 0)
      brake = Math.max(brake, pad.buttons[PAD.LT]?.value ?? 0)
      handbrake ||= !!pad.buttons[PAD.A]?.pressed
      nitro ||= !!pad.buttons[PAD.X]?.pressed || !!pad.buttons[PAD.RB]?.pressed
      this.edge(pad, PAD.START, 'pause')
      this.edge(pad, PAD.Y, 'camera')
      this.edge(pad, PAD.B, 'reset')
    }

    const t = this.touch
    throttle = Math.max(throttle, t.throttle)
    brake = Math.max(brake, t.brake)
    if (t.steer !== 0) steer = t.steer
    handbrake ||= t.handbrake
    nitro ||= t.nitro

    this.state.throttle = throttle
    this.state.brake = brake
    this.state.steer = Math.max(-1, Math.min(1, steer))
    this.state.handbrake = handbrake
    this.state.nitro = nitro
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
    Object.assign(this.touch, { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false })
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }
}
