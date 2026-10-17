import { useState } from 'react'
import { buildStats, carClass, performanceRank } from '../vehicles/CarBuild'
import { TRACKS } from '../world/tracks'
import { useGameInstance } from './GameContext'
import { useGame } from './hooks'
import { Button, ClassBadge, StatBar } from './kit'
import { Settings } from './Settings'

export function MainMenu() {
  const game = useGameInstance()
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="screen screen--menu">
      <header className="menu-top">
        <div className="logo">
          RACING<span>/</span>GAME
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
          Settings
        </Button>
      </header>

      <div className="menu-bottom">
        <CarCard />
        <div className="menu-actions">
          <TrackPicker />
          <Button size="md" onClick={() => game?.openGarage()}>
            Garage
          </Button>
          <Button size="lg" variant="primary" onClick={() => game?.startRace()} autoFocus>
            Race
          </Button>
        </div>
      </div>

      {showSettings && (
        <div className="modal" onClick={() => setShowSettings(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            <Settings onClose={() => setShowSettings(false)} />
          </div>
        </div>
      )}
    </div>
  )
}

/** Name, class, rank and stats of the current build. Shared by menu and garage. */
export function CarCard() {
  const name = useGame((s) => s.carName)
  const build = useGame((s) => s.build)
  const stats = buildStats(build)
  const rank = performanceRank(build)
  return (
    <div className="car-card">
      <div className="car-card__head">
        <ClassBadge value={carClass(rank)} size="lg" />
        <div>
          <div className="car-card__name">{name || 'Loading…'}</div>
          <div className="car-card__rank">
            <span className="eyebrow">Rank</span> <b>{rank}</b>
          </div>
        </div>
      </div>
      <StatBar label="Power" value={stats.power} />
      <StatBar label="Grip" value={stats.grip} />
      <StatBar label="Handling" value={stats.handling} />
      <StatBar label="Braking" value={stats.braking} />
    </div>
  )
}

/** Tap to cycle tracks; switching streams the new track in behind a loading screen. */
function TrackPicker() {
  const trackId = useGame((s) => s.settings.track)
  const trackName = useGame((s) => s.trackName)
  const update = useGame((s) => s.updateSettings)
  const next = () => {
    const i = TRACKS.findIndex((t) => t.id === trackId)
    update({ track: TRACKS[(i + 1) % TRACKS.length].id })
  }
  return (
    <button className="menu-track" onClick={next} aria-label={`Track: ${trackName}. Tap to change.`}>
      <span className="eyebrow">Track ▸</span>
      {trackName}
    </button>
  )
}
