import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InputManager } from '../src/input/InputManager'
import { PAD, readGamepad, stick } from '../src/input/gamepad'

let input: InputManager
let events: EventTarget
let pads: (Gamepad | null)[]
function pad(index = 0): Gamepad {
  return { id: `test ${index}`, index, connected: true, mapping: 'standard', axes: [0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) } as unknown as Gamepad
}
function press(p: Gamepad, index: number, value = 1) {
  Object.assign(p.buttons[index], { pressed: value > 0.5, value })
}
beforeEach(() => {
  events = new EventTarget()
  pads = []
  vi.stubGlobal('window', events)
  vi.stubGlobal('navigator', { getGamepads: () => pads })
  input = new InputManager()
})
afterEach(() => { input.dispose(); vi.unstubAllGlobals() })

it('uses proportional steering and analog triggers while ignoring stick drift', () => {
  const p = pad(); pads = [null, p]
  press(p, PAD.RT, 0.7); press(p, PAD.LT, 0.3)
  p.axes[0] = 0.1
  input.poll()
  expect(input.state).toMatchObject({ steer: 0, throttle: 0.7, brake: 0.3 })
  p.axes[0] = 0.56
  input.poll()
  expect(input.state.steer).toBeCloseTo(0.5)
  expect(stick(-1)).toBe(-1)
  expect(stick(1)).toBe(1)
  expect(stick(NaN)).toBe(0)
})
it('maps driving buttons and emits actions only once per press', () => {
  const p = pad(); pads = [p]; input.poll()
  for (const button of [PAD.A, PAD.X, PAD.Y, PAD.B, PAD.START]) press(p, button)
  input.poll()
  expect(input.state).toMatchObject({ handbrake: true, nitro: true })
  for (const action of ['skip', 'camera', 'reset', 'pause'] as const) expect(input.consume(action)).toBe(true)
  input.poll()
  for (const action of ['skip', 'camera', 'reset', 'pause'] as const) expect(input.consume(action)).toBe(false)
  press(p, PAD.X, 0); press(p, PAD.RB)
  input.poll()
  expect(input.state.nitro).toBe(true)
})
it('suppresses driving actions in menus but still lets Start resume a paused race', () => {
  const p = pad(); pads = [p]; input.poll(true)
  for (const button of [PAD.A, PAD.B, PAD.Y, PAD.START]) press(p, button)
  input.poll(true)
  expect(input.consume('pause')).toBe(true)
  for (const action of ['skip', 'camera', 'reset'] as const) expect(input.consume(action)).toBe(false)
  input.poll()
  expect(input.consume('reset')).toBe(false)
})
it('clears driving state on disconnect and requires fresh action presses after reconnect', () => {
  const p = pad(); pads = [p]; input.poll()
  press(p, PAD.RT); press(p, PAD.Y); input.poll(); input.consume('camera')
  pads = []; input.poll()
  expect(input.state).toMatchObject({ throttle: 0, steer: 0, nitro: false })
  pads = [p]; input.poll()
  expect(input.consume('camera')).toBe(false)
  press(p, PAD.Y, 0); input.poll(); press(p, PAD.Y); input.poll()
  expect(input.consume('camera')).toBe(true)
})
it('clears held inputs on blur and does not drive an unfocused page', () => {
  const p = pad(); pads = [p]; press(p, PAD.RT); input.poll()
  events.dispatchEvent(new Event('blur'))
  input.poll()
  expect(input.state.throttle).toBe(0)
  events.dispatchEvent(new Event('focus')); input.poll()
  expect(input.state.throttle).toBe(1)
})
it('preserves keyboard/touch input and safely handles unavailable gamepad APIs', () => {
  const event = new Event('keydown')
  Object.assign(event, { code: 'KeyW', repeat: false })
  events.dispatchEvent(event)
  input.setTouch({ steer: -0.8, nitro: true })
  vi.stubGlobal('navigator', { getGamepads: () => { throw new Error('denied') } })
  input.poll()
  expect(input.state).toMatchObject({ throttle: 1, steer: -0.8, nitro: true })
  expect(readGamepad()).toBeUndefined()
})
it('ignores nonstandard pads rather than applying the wrong bindings', () => {
  const p = pad(); Object.assign(p, { mapping: '' }); pads = [p]
  press(p, PAD.RT); input.poll()
  expect(input.state.throttle).toBe(0)
})
