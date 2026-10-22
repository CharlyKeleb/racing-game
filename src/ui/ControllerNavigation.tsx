import { useEffect } from 'react'
import { controllerStore } from '../stores/controllerStore'
import type { GamePhase } from '../stores/gameStore'
import { PAD, readGamepad, stick } from '../input/gamepad'
import { controllerControls, moveControllerFocus } from '../input/ControllerMenu'

export function ControllerNavigation({ phase }: { phase: GamePhase }) {
  useEffect(() => {
    let frame = 0, identity = '', previous: boolean[] = [], direction = -1, repeatAt = 0
    const menu = ['menu', 'garage', 'paused', 'finished'].includes(phase)
    const poll = (now: number) => {
      const pad = readGamepad()
      const connected = !!pad
      if (controllerStore.getState().connected !== connected) controllerStore.setState({ connected })
      const key = pad ? `${pad.index}:${pad.id}` : ''
      const pressed = pad?.buttons.map(b => b.pressed) ?? []
      if (key !== identity) { identity = key; previous = pressed; direction = -1 }
      if (pad && menu && document.hasFocus()) {
        const x = stick(pad.axes[0]), y = stick(pad.axes[1])
        const next = pressed[PAD.UP] || y < -0.5 ? PAD.UP : pressed[PAD.DOWN] || y > 0.5 ? PAD.DOWN : pressed[PAD.LEFT] || x < -0.5 ? PAD.LEFT : pressed[PAD.RIGHT] || x > 0.5 ? PAD.RIGHT : -1
        if (next !== -1 && (next !== direction || now >= repeatAt)) {
          document.documentElement.classList.add('controller-input')
          moveControllerFocus(next)
          repeatAt = now + (next !== direction ? 350 : 120)
        }
        direction = next
        if (pressed[PAD.A] && !previous[PAD.A]) {
          document.documentElement.classList.add('controller-input')
          const items = controllerControls()
          const active = document.activeElement as HTMLElement
          if (items.includes(active)) active.click()
          else items[0]?.focus()
        }
        // LB / RB page through the hub's tabs: the hub already binds Q / E for that.
        for (const [button, code] of [[PAD.LB, 'KeyQ'], [PAD.RB, 'KeyE']] as const) {
          if (pressed[button] && !previous[button] && !document.querySelector('dialog[open]')) window.dispatchEvent(new KeyboardEvent('keydown', { code }))
        }
        if (pressed[PAD.B] && !previous[PAD.B]) {
          const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
          const dialog = dialogs.item(dialogs.length - 1)
          if (dialog) dialog.close()
          else controllerControls().find(el => /^(back|resume|close)/i.test(el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''))?.click()
        }
      }
      previous = pressed
      frame = requestAnimationFrame(poll)
    }
    // Real mouse or keyboard input hands focus styling back; the pad's own synthetic keys don't.
    const clearFocus = (e?: Event) => { if (!e || e.isTrusted) document.documentElement.classList.remove('controller-input') }
    window.addEventListener('pointerdown', clearFocus)
    window.addEventListener('keydown', clearFocus)
    frame = requestAnimationFrame(poll)
    return () => {
      cancelAnimationFrame(frame)
      clearFocus()
      window.removeEventListener('pointerdown', clearFocus)
      window.removeEventListener('keydown', clearFocus)
    }
  }, [phase])
  return null
}
