import { GiNextButton, GiPauseButton, GiPlayButton, GiPreviousButton } from 'react-icons/gi'
import { MUSIC_TRACKS, musicTrack, stepMusicTrack } from '../audio/musicTracks'
import { useGame } from './hooks'

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Bottom-left garage radio. It streams the CC0 menu tracks through the game's
 * mixer and remembers the choice in settings; the engine fades it out for a race.
 */
export function MenuMusicBar() {
  const trackId = useGame((s) => s.settings.musicTrack)
  const enabled = useGame((s) => s.settings.menuMusic)
  const update = useGame((s) => s.updateSettings)
  const track = musicTrack(trackId)
  const index = Math.max(0, MUSIC_TRACKS.findIndex((t) => t.id === track.id))
  const change = (step: 1 | -1) => update({ musicTrack: stepMusicTrack(trackId, step).id, menuMusic: true })

  return (
    <section className={`menu-music${enabled ? '' : ' is-off'}`} aria-label="Menu soundtrack">
      <div className="menu-music__meta">
        <span className="eyebrow">
          Garage radio
          <i className="menu-music__license" title={`${track.license} · OpenGameArt`}>CC0</i>
          <span className="menu-music__count"><b>{pad(index + 1)}</b><i>/</i>{pad(MUSIC_TRACKS.length)}</span>
        </span>
        <span className="menu-music__title" aria-live="polite">{track.title}</span>
        <span className="menu-music__artist">{track.artist} · OpenGameArt</span>
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
            onClick={() => update({ menuMusic: !enabled })}
            aria-label={enabled ? 'Pause menu music' : 'Play menu music'}
            aria-pressed={enabled}
            title={enabled ? 'Pause menu music' : 'Play menu music'}
          >
            {enabled ? <GiPauseButton aria-hidden="true" /> : <GiPlayButton aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => change(1)} aria-label="Next music track" title="Next track">
            <GiNextButton aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  )
}
