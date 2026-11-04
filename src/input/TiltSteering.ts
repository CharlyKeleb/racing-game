/**
 * Tilt steering for phones and tablets: turn the device like a steering wheel.
 *
 * The device's orientation (beta, gamma) gives the direction of "down" in the device's own
 * axes; rotated into the screen's axes, its sideways part is how far the screen is tipped left
 * or right. That reading works whether the phone is held upright, tipped back or nearly flat,
 * in landscape or portrait. `tiltDegrees` is pure (numbers in, numbers out); `TiltSteering`
 * listens to the sensor, recentres and smooths.
 */

/** Degrees of tilt for full lock, either way. */
export const TILT_FULL_LOCK = 24
/** Degrees either side of centre that count as straight. */
export const TILT_DEADZONE = 1.5

/**
 * Sideways tilt of the screen in degrees, positive when it's turned clockwise (steer right).
 * `beta`/`gamma` are a DeviceOrientationEvent's, `screenAngle` is screen.orientation.angle.
 */
export function tiltDegrees(beta: number, gamma: number, screenAngle: number): number {
  const b = (beta * Math.PI) / 180, g = (gamma * Math.PI) / 180, s = (screenAngle * Math.PI) / 180
  // "Down" in device axes (x right, y up the portrait screen, z out of it).
  const dx = Math.sin(g) * Math.cos(b)
  const dy = -Math.sin(b)
  // Into screen axes: the content is turned by the screen angle.
  const sx = dx * Math.cos(s) - dy * Math.sin(s)
  const sy = dx * Math.sin(s) + dy * Math.cos(s)
  // Held up, "down" lies in the screen: its angle there is the wheel's angle, at the same
  // sensitivity however far back the phone is tipped. Held flat, only the sideways part reads.
  const flat = Math.asin(Math.max(-1, Math.min(1, sx)))
  const w = Math.max(0, Math.min(1, (Math.hypot(sx, sy) - 0.3) / 0.3))
  const wheel = Math.atan2(sx, Math.max(1e-6, -sy))
  return ((w * wheel + (1 - w) * flat) * 180) / Math.PI
}

/** Tilt (degrees, already recentred) to a steering value in -1..1. */
export function tiltToSteer(degrees: number, fullLock = TILT_FULL_LOCK, deadzone = TILT_DEADZONE): number {
  const a = Math.abs(degrees)
  if (a <= deadzone) return 0
  // Past the dead zone the response starts from zero, so there's no jump at its edge.
  const s = Math.min(1, (a - deadzone) / (fullLock - deadzone))
  return Math.sign(degrees) * s
}

type PermissionRequest = () => Promise<'granted' | 'denied' | 'default'>

/** Set once a prompt was accepted: the next race doesn't ask again this session. */
let granted = false

/** iOS 13+ only hands out orientation after a permission prompt from a tap. */
export function tiltNeedsPermission(): boolean {
  if (granted) return false
  const E = typeof window !== 'undefined' ? (window as unknown as { DeviceOrientationEvent?: { requestPermission?: PermissionRequest } }).DeviceOrientationEvent : undefined
  return typeof E?.requestPermission === 'function'
}

export function tiltSupported(): boolean {
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
}

/** Call from a tap. Resolves true when orientation will be delivered. */
export async function requestTiltPermission(): Promise<boolean> {
  if (!tiltNeedsPermission()) return tiltSupported()
  try {
    const E = (window as unknown as { DeviceOrientationEvent: { requestPermission: PermissionRequest } }).DeviceOrientationEvent
    granted = (await E.requestPermission()) === 'granted'
    return granted
  } catch {
    return false
  }
}

export class TiltSteering {
  /** Smoothed steering, -1..1. */
  steer = 0
  /** Whether a reading has arrived since start(). */
  live = false
  private centre = 0
  private raw = 0
  private listening = false
  private readonly onSteer: (steer: number) => void

  constructor(onSteer: (steer: number) => void) {
    this.onSteer = onSteer
  }

  start(): void {
    if (this.listening || !tiltSupported()) return
    this.listening = true
    window.addEventListener('deviceorientation', this.onOrientation)
  }

  /** The current tilt becomes straight ahead. */
  recentre(): void {
    this.centre = this.raw
  }

  stop(): void {
    if (!this.listening) return
    this.listening = false
    window.removeEventListener('deviceorientation', this.onOrientation)
  }

  private onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.beta === null || e.gamma === null) return
    const angle = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0
    const first = !this.live
    this.raw = tiltDegrees(e.beta, e.gamma, angle)
    // Start straight: whatever angle the phone is held at when the race begins is centre,
    // within reason (a phone held well over is still read as turning).
    if (first) { this.live = true; this.centre = Math.max(-10, Math.min(10, this.raw)) }
    const target = tiltToSteer(this.raw - this.centre)
    // Low-pass: sensors jitter, and a hand isn't perfectly still.
    this.steer += (target - this.steer) * 0.4
    if (Math.abs(this.steer) < 0.01 && target === 0) this.steer = 0
    this.onSteer(this.steer)
  }
}
