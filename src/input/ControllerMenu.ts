import { PAD } from './gamepad'

const SELECTOR = 'button, input, select, [tabindex="0"], a[href]'

/** Controller focus stays inside the topmost modal, just like keyboard focus. */
export function controllerControls(): HTMLElement[] {
  const dialogs = document.querySelectorAll('dialog[open]')
  const scope = dialogs.item(dialogs.length - 1) ?? document.querySelector('.overlay')
  return Array.from(scope?.querySelectorAll<HTMLElement>(SELECTOR) ?? []).filter(el =>
    !el.matches(':disabled, [aria-disabled="true"]') && !el.closest('[inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

export function moveControllerFocus(direction: number): void {
  const items = controllerControls()
  if (!items.length) return
  const current = document.activeElement as HTMLElement
  const index = items.indexOf(current)
  if (index < 0) { items[0].focus(); return }
  if ((direction === PAD.LEFT || direction === PAD.RIGHT) && current instanceof HTMLInputElement && current.type === 'range') {
    const sign = direction === PAD.LEFT ? -1 : 1
    const next = Math.max(Number(current.min || 0), Math.min(Number(current.max || 100), Number(current.value) + sign * Number(current.step || 1)))
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(current, String(next))
    current.dispatchEvent(new Event('input', { bubbles: true }))
    current.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }
  const rect = current.getBoundingClientRect()
  const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2
  const horizontal = direction === PAD.LEFT || direction === PAD.RIGHT
  const sign = direction === PAD.LEFT || direction === PAD.UP ? -1 : 1
  let best: HTMLElement | undefined, score = Infinity
  for (const item of items) {
    if (item === current) continue
    const r = item.getBoundingClientRect()
    const dx = r.left + r.width / 2 - x, dy = r.top + r.height / 2 - y
    const along = (horizontal ? dx : dy) * sign
    if (along <= 1) continue
    const across = Math.abs(horizontal ? dy : dx)
    const candidate = along + across * 3
    if (candidate < score) { score = candidate; best = item }
  }
  const next = best ?? items[(index + sign + items.length) % items.length]
  next.focus()
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

