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

/**
 * Holds the screen on while racing: tilt steering can go a minute without a touch, and the
 * phone would dim. Returns a release function. Silently does nothing where unsupported.
 */
export function keepScreenAwake(): () => void {
  type Sentinel = { release(): Promise<void>; released?: boolean }
  const wake = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<Sentinel> } }).wakeLock
  if (!wake) return () => {}
  let sentinel: Sentinel | null = null
  let done = false
  const acquire = () => {
    if (done || document.hidden) return
    wake.request('screen').then((s) => { if (done) void s.release(); else sentinel = s }).catch(() => {})
  }
  // The lock drops whenever the page is hidden; take it again on return.
  const onVisible = () => { if (!document.hidden && (!sentinel || sentinel.released)) acquire() }
  document.addEventListener('visibilitychange', onVisible)
  acquire()
  return () => {
    done = true
    document.removeEventListener('visibilitychange', onVisible)
    void sentinel?.release().catch(() => {})
  }
}

/** From a tap: full screen and landscape where the browser allows it (Android); iOS ignores both. */
export async function enterLandscapeFullscreen(): Promise<void> {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void }
  try {
    if (!document.fullscreenElement) {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' })
      else el.webkitRequestFullscreen?.()
    }
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape')
  } catch {
    // Not allowed here (desktop, iOS, or no user gesture): the game runs as it is.
  }
}
