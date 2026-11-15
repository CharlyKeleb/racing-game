import { RACE_MUSIC_TRACKS, RacePlaylist, type MusicTrack } from './musicTracks'

/** Music level before the setting and master volume: up with the engine, like a racing game's radio. */
const LEVEL = 0.6
const FADE_IN = 1.6
const FADE_OUT = 0.8
/** On top of the bed duck (narrationMix): music drops ~14 dB in all under a commentary line. */
const COMMENTARY_LEVEL = 0.38
/** A callout chime gets a short dip, so it lands on the beat of the event rather than in the mix. */
const CHIME_LEVEL = 0.55
const CHIME_HOLD = 0.5

/**
 * The in-race soundtrack: a shuffled playlist of streamed MP3s through the
 * shared AudioContext (master volume, limiter, and the bed that ducks under
 * commentary). One <audio> element, moving to the next track when one ends.
 * It starts at lights out, keeps going through the finish, and pauses (keeping
 * its place) for the menu, so the next race picks up where the radio left off.
 */
export class RaceMusic {
  private readonly ctx: AudioContext
  private readonly out: GainNode
  private readonly duck: GainNode
  private readonly audio: HTMLAudioElement
  private readonly playlist = new RacePlaylist(RACE_MUSIC_TRACKS.length)
  private track: MusicTrack | null = null
  private enabled = true
  private volume = 1
  private active = false
  private held = false
  private commentary = false
  private pauseTimer: ReturnType<typeof setTimeout> | null = null
  private readonly onTrack: (track: MusicTrack | null) => void

  constructor(ctx: AudioContext, destination: AudioNode, onTrack: (track: MusicTrack | null) => void = () => {}) {
    this.ctx = ctx
    this.onTrack = onTrack
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.duck = ctx.createGain()
    this.out.connect(this.duck).connect(destination)
    this.audio = new Audio()
    this.audio.preload = 'auto'
    this.audio.addEventListener('ended', this.advance)
    // A missing or undecodable file skips to the next track instead of leaving the race silent.
    this.audio.addEventListener('error', this.skip)
    this.audio.addEventListener('playing', () => { this.failures = 0 })
    ctx.createMediaElementSource(this.audio).connect(this.out)
  }

  setEnabled(enabled: boolean, volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (enabled === this.enabled) {
      // Also while held: a change from the pause menu applies when the race resumes.
      if (this.enabled && this.active) this.fadeTo(this.level(), 0.15)
      return
    }
    this.enabled = enabled
    this.sync()
  }

  /** On track and racing (lights out through the results) = true; menu, intro, grid = false. */
  setActive(active: boolean): void {
    if (active === this.active) return
    this.active = active
    this.sync()
  }

  /** Pause menu: the context is suspended, so hold the element too or it plays on silently. */
  setHeld(held: boolean): void {
    if (held === this.held) return
    this.held = held
    if (held) this.audio.pause()
    else if (this.shouldPlay()) void this.audio.play().catch(() => {})
  }

  /** Under a commentary line (on top of the bed duck). */
  setCommentary(on: boolean): void {
    if (on === this.commentary) return
    this.commentary = on
    const now = this.ctx.currentTime
    const g = this.duck.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.setTargetAtTime(on ? COMMENTARY_LEVEL : 1, now, on ? 0.04 : 0.3)
  }

  /** Brief dip for a callout chime; never lifts a commentary duck. */
  dipForChime(): void {
    if (this.commentary) return
    const now = this.ctx.currentTime
    const g = this.duck.gain
    g.cancelScheduledValues(now)
    g.setValueAtTime(g.value, now)
    g.linearRampToValueAtTime(CHIME_LEVEL, now + 0.03)
    g.setTargetAtTime(1, now + CHIME_HOLD, 0.2)
  }

  /** Retry after a user gesture clears an autoplay block. */
  retry(): void {
    if (this.shouldPlay()) void this.audio.play().catch(() => {})
  }

  private shouldPlay(): boolean {
    return this.enabled && this.active && !this.held && this.volume > 0
  }

  private level(): number {
    return LEVEL * this.volume
  }

  private sync(): void {
    if (this.enabled && this.active) this.play()
    else this.stop()
  }

  private play(): void {
    this.clearPauseTimer()
    if (!this.track) this.load(this.playlist.next())
    if (!this.held) void this.audio.play().catch(() => {})
    this.onTrack(this.track)
    this.fadeTo(this.level(), FADE_IN)
  }

  private stop(): void {
    this.fadeTo(0, FADE_OUT)
    this.onTrack(null)
    this.clearPauseTimer()
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null
      if (!(this.enabled && this.active)) this.audio.pause()
    }, FADE_OUT * 1000 + 80)
  }

  private load(index: number): void {
    const track = RACE_MUSIC_TRACKS[index]
    if (!track) return
    this.track = track
    this.audio.src = track.file
    this.audio.load()
  }

  private readonly advance = (): void => {
    this.load(this.playlist.next())
    if (this.enabled && this.active) {
      if (!this.held) void this.audio.play().catch(() => {})
      this.onTrack(this.track)
    }
  }

  private failures = 0
  private readonly skip = (): void => {
    // Every file failing (offline, assets missing) must not spin forever.
    if (++this.failures > RACE_MUSIC_TRACKS.length) return
    this.advance()
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
    this.audio.removeEventListener('ended', this.advance)
    this.audio.removeEventListener('error', this.skip)
    this.audio.pause()
    this.audio.removeAttribute('src')
    this.audio.load()
    this.out.disconnect()
    this.duck.disconnect()
  }
}
