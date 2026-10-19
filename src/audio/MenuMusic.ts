import type { MusicTrack } from './musicTracks'

/** Music level before the master volume; sits under the menu room tone and UI. */
const LEVEL = 0.22
const FADE_IN = 0.9
const FADE_OUT = 0.55

/**
 * The menu/garage soundtrack. One looping <audio> element streamed through the
 * shared AudioContext, so the master volume and limiter apply to it like every
 * other sound, and a 4 MB MP3 doesn't need to be decoded into memory.
 *
 * It only runs in the showroom (`setActive`), fades rather than cuts when the
 * race starts, and pauses once it's silent to leave the audio thread alone.
 */
export class MenuMusic {
  private readonly ctx: AudioContext
  private readonly out: GainNode
  private readonly audio: HTMLAudioElement
  private url = ''
  private enabled = true
  private active = false
  private pauseTimer: ReturnType<typeof setTimeout> | null = null

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.out.connect(destination)

    this.audio = new Audio()
    this.audio.loop = true
    this.audio.preload = 'auto'
    ctx.createMediaElementSource(this.audio).connect(this.out)
  }

  /** Switch tracks. The old one stops immediately; the new one fades in. */
  setTrack(track: MusicTrack): void {
    if (track.file === this.url) return
    this.url = track.file
    this.clearPauseTimer()
    this.out.gain.cancelScheduledValues(this.ctx.currentTime)
    this.out.gain.setValueAtTime(0, this.ctx.currentTime)
    this.audio.src = track.file
    this.audio.load()
    if (this.shouldPlay()) this.play()
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    this.enabled = enabled
    if (enabled) this.play()
    else this.stop()
  }

  /** Menu/garage = true, race = false. */
  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    if (active) this.play()
    else this.stop()
  }

  private shouldPlay(): boolean {
    return this.enabled && this.active && this.url !== ''
  }

  private play(): void {
    if (!this.shouldPlay()) return
    this.clearPauseTimer()
    void this.audio.play().catch(() => {
      // Autoplay was refused before the first gesture; the menu's next click
      // calls setTrack/setEnabled again and retries.
    })
    this.fadeTo(LEVEL, FADE_IN)
  }

  private stop(): void {
    this.fadeTo(0, FADE_OUT)
    this.clearPauseTimer()
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null
      if (!this.shouldPlay()) this.audio.pause()
    }, FADE_OUT * 1000 + 80)
  }

  private fadeTo(level: number, seconds: number): void {
    const now = this.ctx.currentTime
    const gain = this.out.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(level, now + seconds)
  }

  private clearPauseTimer(): void {
    if (this.pauseTimer !== null) clearTimeout(this.pauseTimer)
    this.pauseTimer = null
  }

  dispose(): void {
    this.clearPauseTimer()
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.out.disconnect()
  }
}
