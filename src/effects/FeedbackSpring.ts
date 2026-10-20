/** Small visual-only spring, integrated in bounded substeps even after a hitch. */
export class FeedbackSpring {
  value = 0
  velocity = 0
  readonly frequency: number
  readonly damping: number
  constructor(frequency: number, damping: number) { this.frequency = frequency; this.damping = damping }
  step(target: number, dt: number): number {
    if (!(dt > 0)) return this.value
    const seconds = Math.min(dt, .1)
    const count = Math.ceil(seconds * 120), h = seconds / count
    for (let i = 0; i < count; i++) {
      this.velocity += (this.frequency ** 2 * (target - this.value) - 2 * this.damping * this.frequency * this.velocity) * h
      this.value += this.velocity * h
    }
    return this.value
  }
  reset(): void { this.value = this.velocity = 0 }
}
