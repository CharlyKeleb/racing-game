/** Browsers map Xbox, PlayStation and compatible pads to this common layout. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const
const DEADZONE = 0.12

export function stick(value = 0): number {
  if (!Number.isFinite(value) || Math.abs(value) <= DEADZONE) return 0
  return Math.sign(value) * Math.min(1, (Math.abs(value) - DEADZONE) / (1 - DEADZONE))
}

export function readGamepad(): Gamepad | undefined {
  // Some embedded browsers expose the API but deny access to it.
  try { return Array.from(navigator.getGamepads?.() ?? []).find(p => p?.connected && p.mapping === 'standard') ?? undefined }
  catch { return undefined }
}
