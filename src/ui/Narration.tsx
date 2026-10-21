import { CommentaryDirector } from '../audio/CommentaryDirector'
import { attachNarrationDucking } from '../audio/narrationMix'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { narrationText, NARRATOR_NAMES, NARRATOR_PORTRAITS, narrationClip, revealedCharacters, type NarrationId, type NarratorVoice } from '../audio/narration'
import { gameStore } from '../stores/gameStore'
import { telemetryStore } from '../stores/telemetryStore'
import { useGame } from './hooks'

export function Narration() {
  const phase = useGame(s => s.phase)
  const narrator = useGame(s => s.settings.narrator)
  const enabled = useGame(s => s.settings.callouts)
  const volume = useGame(s => s.settings.narratorVolume * s.settings.masterVolume)
  const [line, setLine] = useState<{ id: NarrationId; key: number; speaker: NarratorVoice } | null>(null)
  const [reveal, setReveal] = useState({ key: 0, count: 0 })
  const director = useRef(new CommentaryDirector())
  const previousNarrator = useRef(narrator)
  const previous = useRef(phase)
  const lastCallout = useRef<object | null>(null)
  const tipped = useRef(false)
  const finishAnnounced = useRef(false)
  const photoFinish = useRef(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sequence = useRef(0)
  const panelRef = useRef<HTMLDivElement>(null)
  const visible = line !== null
  // Follow the rendered HUD bounds, including touch scaling and different modes.
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const overlay = panel.parentElement!
    const header = overlay.querySelector<HTMLElement>('.hud-tl')
    const position = () => {
      if (!header) return
      const bounds = header.getBoundingClientRect()
      const parent = overlay.getBoundingClientRect()
      panel.style.top = `${bounds.bottom - parent.top + 12}px`
      panel.style.left = `${bounds.left - parent.left}px`
    }
    position()
    const observer = new ResizeObserver(position)
    if (header) observer.observe(header)
    observer.observe(overlay)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [phase, visible])
  useEffect(() => {
    const update = () => {
      const { phase, settings: { mode, narrator, callouts: enabled } } = gameStore.getState()
      const { callout, totalMs, finishSeconds, finishProgress, finishReduced } = telemetryStore.getState()
      const tipDue = totalMs >= 8000
      const before = previous.current
      previous.current = phase
      const say = (id: NarrationId) => {
        const speaker = director.current.choose(narrator, id, (voice, clip) => !!narrationClip(voice, clip))
        if (speaker) setLine({ id, speaker, key: ++sequence.current })
      }
      if (previousNarrator.current !== narrator) {
        previousNarrator.current = narrator
        setLine(null)
        return
      }
      if (!enabled || narrator === 'off' || !['intro', 'countdown', 'racing', 'finished'].includes(phase)) {
        setLine(null)
        return
      }
      if (phase === 'finished') {
        if (before !== phase) { finishAnnounced.current = false; photoFinish.current = false; setLine(null) }
        if (callout?.kind === 'finish') photoFinish.current = true
        if (finishProgress >= 1) { setLine(null); return }
        // Give the finish sting and result badge their beat before the commentary.
        if (!finishAnnounced.current && finishSeconds >= (finishReduced ? .1 : 3.8)) {
          finishAnnounced.current = true
          say(photoFinish.current ? 'finish' : 'raceComplete')
        }
        return
      }
      if (phase === 'intro' && before !== phase) { tipped.current = false; lastCallout.current = null; say('welcome') }
      if (phase === 'countdown' && before !== phase && before !== 'paused') { tipped.current = false; lastCallout.current = null; say('countdown') }
      if (phase === 'racing' && before !== phase && before !== 'paused') say(mode === 'quick' ? 'start' : mode)
      if (callout && callout !== lastCallout.current && phase === 'racing') {
        lastCallout.current = callout
        tipped.current = true // Don't interrupt race commentary with the beginner tip.
        say(callout.kind)
      } else if (phase === 'racing' && mode === 'quick' && tipDue && !tipped.current) {
        tipped.current = true
        say('quickTip')
      }
    }
    const unsubscribeGame = gameStore.subscribe(update)
    const unsubscribeTelemetry = telemetryStore.subscribe(update)
    return () => { unsubscribeGame(); unsubscribeTelemetry() }
  }, [])
  useEffect(() => {
    if (!line || narrator === 'off') return
    const text = narrationText(line.speaker, line.id)
    const url = narrationClip(line.speaker, line.id)
    const audio = url ? new Audio(url) : null
    audioRef.current = audio
    const detachDucking = audio ? attachNarrationDucking(audio) : () => {}
    let stopped = false, frame = 0, started = performance.now(), doneAt = 0, playing = false, failed = false
    const fallback = () => { failed = true; playing = false; started = performance.now(); if (audio) { audio.onplaying = null; audio.pause() } }
    if (audio) {
      const s = gameStore.getState().settings
      audio.volume = Math.max(0, Math.min(1, s.narratorVolume * s.masterVolume))
      audio.onplaying = () => { playing = true }
      audio.onerror = fallback
      audio.play().catch(fallback)
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tick = (now: number) => {
      if (stopped) return
      const duration = Math.max(1800, text.length * 38)
      if (audio && !playing && !failed && now - started > 2500) fallback()
      const progress = audio && !playing && !failed ? 0 : playing && audio && Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.currentTime / audio.duration : (now - started) / duration
      const complete = audio && playing ? audio.ended : progress >= 1
      const count = reducedMotion ? text.length : revealedCharacters(text, complete ? 1 : progress)
      setReveal(old => old.key === line.key && old.count === count ? old : { key: line.key, count })
      if (complete) {
        if (!doneAt) doneAt = now
        if (now - doneAt >= 1100) { setLine(null); return }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { detachDucking(); stopped = true; cancelAnimationFrame(frame); if (audio) { audio.pause(); audio.onplaying = null; audio.onerror = null; audio.removeAttribute('src'); audio.load() }; audioRef.current = null }
  }, [line, narrator])
  useEffect(() => { if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, volume)) }, [volume])
  if (!line || narrator === 'off' || !enabled || !['intro', 'countdown', 'racing', 'finished'].includes(phase)) return null
  const text = narrationText(line.speaker, line.id)
  return <div ref={panelRef} className={`narration${phase === 'intro' ? ' narration--intro' : ''}`} data-tag-exclusion aria-label={`${NARRATOR_NAMES[line.speaker]} commentary`}>
    {NARRATOR_PORTRAITS[line.speaker]
      ? <div className="narration__portrait"><img src={NARRATOR_PORTRAITS[line.speaker]} alt="" /></div>
      : <div className="narration__portrait narration__initial" aria-hidden="true">CL</div>}
    <div className="narration__copy">
      <div className="narration__heading"><span className="eyebrow">{NARRATOR_NAMES[line.speaker]}</span><small>Race radio</small></div>
      <p aria-hidden="true">{text.slice(0, reveal.key === line.key ? reveal.count : 0)}<span className="narration__cursor">▌</span></p>
    </div>
    <span className="narration__accessible" role="status">{text}</span>
  </div>
}
