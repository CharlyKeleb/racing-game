import { GiPauseButton, GiPlayButton } from 'react-icons/gi'
import { attachNarrationDucking } from '../audio/narrationMix'
import { useEffect, useRef, useState } from 'react'
import { narrationText, NARRATOR_NAMES, NARRATOR_PORTRAITS, narrationClip, type NarratorVoice } from '../audio/narration'
import { useGame } from './hooks'
import { Segmented } from './kit'

export function NarratorPreview() {
  const mode = useGame(s => s.settings.narrator)
  const [preview, setPreview] = useState<NarratorVoice>('alex')
  if (mode === 'off') return null
  const voice = mode === 'duo' ? preview : mode
  return <>
    {mode === 'duo' && <Segmented<NarratorVoice> label="Meet the commentators" value={preview} options={[[ 'alex','Alex'],['camille','Camille']]} onPick={setPreview}/>}
    <VoicePreview key={voice} voice={voice}/>
  </>
}

/** One preview player at a time, including when both commentators are selected. */
function VoicePreview({ voice }: { voice: NarratorVoice }) {
  const volume = useGame(s => s.settings.narratorVolume * s.settings.masterVolume)
  const audio = useRef<HTMLAudioElement>(null)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [error, setError] = useState(false)
  const url = narrationClip(voice, 'introduction')
  useEffect(() => { if (audio.current) audio.current.volume = Math.max(0, Math.min(1, volume)) }, [volume, url])
  useEffect(() => {
    const element = audio.current
    const detach = element ? attachNarrationDucking(element) : () => {}
    return () => { detach(); element?.pause() }
  }, [url])
  if (!url) return null
  const text = narrationText(voice, 'introduction')
  const name = NARRATOR_NAMES[voice]
  const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
  const toggle = () => {
    const element = audio.current
    if (!element) return
    if (!element.paused) { element.pause(); return }
    if (element.ended) element.currentTime = 0
    setError(false)
    setBuffering(true)
    void element.play().catch(() => { setError(true); setBuffering(false); setPlaying(false) })
  }
  return <section className="narrator-preview" aria-label={`${name} voice preview`}>
    <div className="narrator-preview__identity">
      <div className="narration__portrait"><img src={NARRATOR_PORTRAITS[voice]} alt=""/></div>
      <div className="narrator-preview__meta"><span className="eyebrow">Race commentary</span><strong>{name}</strong><span>{voice === 'alex' ? 'American English' : 'British English'}</span></div>
      <span className={`narrator-preview__status${playing ? ' is-live' : ''}`} role="status">{error ? 'Try again' : buffering ? 'Loading' : playing ? 'On air' : elapsed > 0 && elapsed < duration ? 'Paused' : 'Preview'}</span>
    </div>
    <audio ref={audio} preload="metadata" src={url} aria-hidden="true"
      onLoadedMetadata={e => { const d = e.currentTarget.duration; setDuration(Number.isFinite(d) ? d : 0) }}
      onTimeUpdate={e => setElapsed(e.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)}
      onPlaying={() => { setPlaying(true); setBuffering(false); setError(false) }}
      onWaiting={() => setBuffering(true)}
      onPause={() => { setPlaying(false); setBuffering(false) }}
      onEnded={() => { setPlaying(false); setBuffering(false) }}
      onError={() => { setError(true); setBuffering(false); setPlaying(false) }} />
    <p className="narrator-preview__script">{text}</p>
    <div className="narrator-preview__transport">
      <button type="button" className="narrator-preview__play" aria-label={`${playing ? 'Pause' : 'Play'} ${name} preview`} aria-pressed={playing} onClick={toggle}>
        {playing ? <GiPauseButton aria-hidden="true"/> : <GiPlayButton aria-hidden="true"/>}
      </button>
      <div className="narrator-preview__timeline">
        <input className="ui-range" type="range" aria-label={`Seek ${name} preview`} aria-valuetext={`${clock(elapsed)} of ${clock(duration)}`} min={0} max={duration || 1} step={.01} value={Math.min(elapsed, duration || 1)} disabled={!duration} onChange={e => {
          const time = Number(e.target.value)
          if (audio.current) audio.current.currentTime = time
          setElapsed(time)
        }}/>
        <div className="narrator-preview__times mono"><span>{clock(elapsed)}</span><span>{clock(duration)}</span></div>
      </div>
    </div>
    {error && <p className="narrator-preview__error" role="alert">Couldn’t play this preview. Press play to retry.</p>}
  </section>
}
