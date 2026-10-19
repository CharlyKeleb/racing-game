import { BloomEffect } from 'postprocessing'

/** Scale the complete bloom pyramid, leaving the scene, AA and final composite at full resolution. */
export class ScaledBloomEffect extends BloomEffect {
  renderScale = 1
  private sizing = false

  override setSize(width: number, height: number): void {
    // Bloom's Resolution emits a synchronous resize callback when its base size
    // changes. It already receives scaled dimensions; do not scale them twice.
    if (this.sizing) return
    this.sizing = true
    try {
      const scale = this.renderScale ?? 1
      super.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
    } finally {
      this.sizing = false
    }
  }
}
