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
  private playing = false
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onPlayingChange: (playing: boolean) => void

  constructor(ctx: AudioContext, destination: AudioNode, onPlayingChange: (playing: boolean) => void = () => {}) {
    this.ctx = ctx
    this.onPlayingChange = onPlayingChange
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.out.connect(destination)

    this.audio = new Audio()
    this.audio.loop = true
    this.audio.preload = 'auto'
    this.audio.addEventListener('playing', this.syncPlaying)
    this.audio.addEventListener('pause', this.syncPlaying)
    this.audio.addEventListener('emptied', this.syncPlaying)
    ctx.addEventListener('statechange', this.syncPlaying)
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

  /** Retry after a user gesture clears the browser's autoplay block. */
  retry(): void {
    if (this.shouldPlay()) this.play()
  }

  private shouldPlay(): boolean {
    return this.enabled && this.active && this.url !== ''
  }

  private play(): void {
    if (!this.shouldPlay()) return
    this.clearPauseTimer()
    // The element can be playing while the context is still suspended (an
    // autoplay-blocked AudioContext), which is silent. syncPlaying treats only
    // "element playing AND context running" as actually audible.
    void this.audio.play().then(this.syncPlaying, () => this.setPlaying(false))
    this.fadeTo(LEVEL, FADE_IN)
  }

  /** Published state is audible state, never just "we asked it to play". */
  private readonly syncPlaying = (): void => {
    this.setPlaying(!this.audio.paused && this.ctx.state === 'running')
  }

  private setPlaying(playing: boolean): void {
    if (playing === this.playing) return
    this.playing = playing
    this.onPlayingChange(playing)
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
    this.ctx.removeEventListener('statechange', this.syncPlaying)
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.out.disconnect()
  }
}
