/** A timed solo run. Link slides within 1.5s; resets forfeit the unbanked chain. */
export const DRIFT_DURATION = 120
export class DriftChallenge {
  total = 0
  chain = 0
  multiplier = 1
  private sliding = 0
  private gap = 0

  update(dt: number, points: number, valid: boolean): void {
    if (valid && points > 0) {
      this.gap = 0
      this.sliding += dt
      this.multiplier = Math.min(5, 1 + Math.floor(this.sliding / 3))
      this.chain += points * this.multiplier
    } else if (this.chain > 0) {
      this.gap += dt
      if (this.gap >= 1.5) this.bank()
    }
  }

  bank(): void {
    this.total += Math.round(this.chain)
    this.discard()
  }

  discard(): void {
    this.chain = this.sliding = this.gap = 0
    this.multiplier = 1
  }

  reset(): void { this.total = 0; this.discard() }
}
