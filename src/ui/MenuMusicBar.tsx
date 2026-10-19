import { GiNextButton, GiPauseButton, GiPlayButton, GiPreviousButton } from 'react-icons/gi'
import { MUSIC_TRACKS, musicTrack, stepMusicTrack } from '../audio/musicTracks'
import { useGameInstance } from './GameContext'
import { useGame } from './hooks'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Bottom-left garage radio. It streams the CC0 menu tracks through the game's
 * mixer and remembers the choice in settings; the engine fades it out for a race.
 */
export function MenuMusicBar() {
  const game = useGameInstance()
  const trackId = useGame((s) => s.settings.musicTrack)
  const enabled = useGame((s) => s.settings.menuMusic)
  const playing = useGame((s) => s.musicPlaying)
  const update = useGame((s) => s.updateSettings)
  const track = musicTrack(trackId)
  const index = Math.max(0, MUSIC_TRACKS.findIndex((t) => t.id === track.id))
  const live = enabled && playing
  const change = (step: 1 | -1) => update({ musicTrack: stepMusicTrack(trackId, step).id, menuMusic: true })
  const toggle = () => {
    if (!enabled) update({ menuMusic: true })
    else if (live) update({ menuMusic: false })
    else game?.unlockAudio()
  }

  return (
    <section className={`menu-music${live ? '' : ' is-off'}`} aria-label="Menu soundtrack">
      <div className="menu-music__meta">
        <span className="eyebrow">
          Garage radio
          <i className="menu-music__license" title={`${track.license} · OpenGameArt`}>CC0</i>
          <span className="menu-music__count"><b>{pad(index + 1)}</b><i>/</i>{pad(MUSIC_TRACKS.length)}</span>
        </span>
        <span className="menu-music__title" aria-live="polite">{track.title}</span>
        <span className="menu-music__artist">
          <span>{track.artist} · OpenGameArt</span>
          <em className={`menu-music__status${live ? ' is-live' : enabled ? ' is-call' : ''}`} aria-live="polite">
            {live ? 'On air' : enabled ? 'Tap to play' : 'Muted'}
          </em>
        </span>
      </div>
      <div className="menu-music__side">
        <span className="menu-music__wave" aria-hidden="true"><i /><i /><i /><i /></span>
        <div className="menu-music__controls">
          <button type="button" onClick={() => change(-1)} aria-label="Previous music track" title="Previous track">
            <GiPreviousButton aria-hidden="true" />
          </button>
          <button
            type="button"
            className="menu-music__toggle"
            onClick={toggle}
            aria-label={live ? 'Pause menu music' : 'Play menu music'}
            aria-pressed={live}
            title={live ? 'Pause menu music' : 'Play menu music'}
          >
            {live ? <GiPauseButton aria-hidden="true" /> : <GiPlayButton aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => change(1)} aria-label="Next music track" title="Next track">
            <GiNextButton aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  )
}
