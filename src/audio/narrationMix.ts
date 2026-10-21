import { createStore } from 'zustand/vanilla'

/** Narrator media bypasses the game mixer, so ducking the game never ducks speech. */
export const narrationMix = createStore<{ voices: number }>(() => ({ voices: 0 }))
export const NARRATION_GAME_LEVEL = .08

/** A release belongs to one playback; overlapping previews cannot unduck each other. */
export function beginNarration(): () => void {
  narrationMix.setState(s => ({ voices: s.voices + 1 }))
  let released = false
  return () => {
    if (released) return
    released = true
    narrationMix.setState(s => ({ voices: Math.max(0, s.voices - 1) }))
  }
}

/** Only audible, actively playing media lowers the game. Every exit restores it. */
export function attachNarrationDucking(audio: HTMLAudioElement): () => void {
  let release: (() => void) | undefined
  let playing = false
  const sync = () => {
    if (playing && !audio.paused && !audio.ended && !audio.muted && audio.volume > 0) {
      release ??= beginNarration()
    } else { release?.(); release = undefined }
  }
  const start = () => { playing = true; sync() }
  const stop = () => { playing = false; sync() }
  audio.addEventListener('playing', start)
  audio.addEventListener('volumechange', sync)
  const stops = ['pause', 'ended', 'waiting', 'error', 'emptied'] as const
  stops.forEach(event => audio.addEventListener(event, stop))
  return () => {
    stop()
    audio.removeEventListener('playing', start)
    audio.removeEventListener('volumechange', sync)
    stops.forEach(event => audio.removeEventListener(event, stop))
  }
}
