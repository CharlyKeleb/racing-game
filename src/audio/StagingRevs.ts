/**
 * Engine revs on the grid before lights out: idle with the odd blip during the
 * intro, building to a held rev through the countdown. Sound and tach only; the
 * physics drivetrain stays parked until the race starts.
 */
export class StagingRevs {
  rpm = 0
  throttle = 0
  private blip = 0
  private blipLevel = 0
  private next: number
  private seed: number

  constructor(seed: number) {
    this.seed = (seed * 7919 + 104729) % 233280
    this.next = 0.5 + this.random() * 1.5
  }

  /** Small LCG so every car blips on its own rhythm without allocating. */
  private random(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280
    return this.seed / 233280
  }

  reset(idleRpm: number): void {
    this.rpm = idleRpm
    this.throttle = 0
    this.blip = 0
    this.next = 0.5 + this.random() * 1.5
  }

  /** Rev now, e.g. when the camera cuts onto this car. `level` is a share of the rev range. */
  kick(level: number, seconds: number): void {
    this.blipLevel = level
    this.blip = seconds
  }

  /**
   * @param hold sustained rev level under the blips, 0..1 of the rev range
   * @param pedal the driver's own throttle, 0..1; when given, it replaces the automatic blips
   */
  update(dt: number, idleRpm: number, redlineRpm: number, hold: number, pedal = -1): void {
    if (this.blip > 0) this.blip -= dt
    else if ((this.next -= dt) <= 0) {
      this.kick(0.4 + 0.3 * this.random(), 0.12 + 0.18 * this.random())
      this.next = Math.max(0.35, 0.8 + 1.6 * this.random() - hold)
    }
    const level = pedal >= 0 ? pedal * 0.9 : Math.max(hold, this.blip > 0 ? this.blipLevel : 0)
    const target = idleRpm + (redlineRpm - idleRpm) * level
    // Revs snap up and fall back slower, like a free-revving engine against its flywheel.
    this.rpm += (target - this.rpm) * (1 - Math.exp(-(target > this.rpm ? 10 : 3.5) * dt))
    this.throttle = level > 0.05 ? Math.min(1, level * 1.3) : 0
  }
}
