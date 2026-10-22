import type { QualityPreset } from '../stores/gameStore'

/**
 * Coarse device classification used for first-run defaults. Players can still
 * change quality in Settings; the dynamic-resolution scaler in Renderer covers
 * whatever this guesses wrong.
 */

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return navigator.maxTouchPoints > 0 || window.matchMedia?.('(pointer: coarse)').matches === true
}

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS reports as Mac; touch points give it away.
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function defaultQuality(): QualityPreset {
  if (typeof navigator === 'undefined') return 'high'
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  if (isMobile()) return cores >= 8 && memory >= 6 ? 'medium' : 'low'
  // CPU count is not a GPU benchmark. Start conservatively; saved choices win.
  return cores <= 2 || memory <= 2 ? 'low' : 'medium'
}
