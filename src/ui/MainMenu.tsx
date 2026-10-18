import { GiCheckeredFlag, GiStopwatch, GiRaceCar, GiRoad, GiHomeGarage, GiGears } from 'react-icons/gi'
import { useEffect, useState } from 'react'
import { buildStats, carClass, performanceRank } from '../vehicles/CarBuild'
import { getCar } from '../vehicles/carRegistry'
import { GAME_MODES } from '../racing/gameModes'
import { useGameInstance } from './GameContext'
import { useGame } from './hooks'
import { CarPicker } from './CarPicker'
import { Button, ClassBadge, StatBar } from './kit'
import { OrbitLayer } from './OrbitLayer'
import { SettingsDialog } from './Settings'
import { RaceSetup } from './RaceSetup'
import { TrackSelection } from './TrackSelection'
import { TrackAerial } from './TrackAerial'
import trackPreviews from './trackPreviews.json'
import { RevButton } from './RevButton'
import { TIME_PRESETS } from '../world/timeOfDay'

export function MainMenu() {
  const game = useGameInstance()
  const [showSettings, setShowSettings] = useState(false)
  const [showRaceSetup, setShowRaceSetup] = useState(false)
  const settings = useGame((s) => s.settings)
  // Browsers only start audio from a user gesture: the first click or key in
  // the menu brings up the garage's room tone.
  useEffect(() => {
    if (!game) return
    const start = () => game.unlockAudio()
    window.addEventListener('pointerdown', start, { once: true })
    window.addEventListener('keydown', start, { once: true })
    return () => {
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
    }
  }, [game])
  const switching = useGame((s) => s.carSwitching || s.trackSwitching)

  return (
    <div className="screen screen--menu">
      <OrbitLayer />
      <header className="menu-top">
        <div className="logo">
          RACING<span>/</span>GAME
        </div>
        <Button size="sm" className="menu-settings menu-icon-action" aria-label="Settings" onClick={() => setShowSettings((v) => !v)} aria-expanded={showSettings}>
          <GiGears aria-hidden="true"/> Settings
        </Button>
      </header>

      <div className="menu-bottom">
        <div className="menu-car">
          <CarPicker />
          <CarCard />
          <RevButton />
        </div>
        <div className="menu-actions">
          <ModeSelect />
          <TrackPicker />
          <Button size="sm" variant="ghost" onClick={() => setShowRaceSetup(true)}>
            {settings.mode === 'drift' ? 'Drift setup · 2 minutes' : `Race setup · ${settings.laps} ${settings.laps === 1 ? 'lap' : 'laps'}`} · {TIME_PRESETS[settings.timeOfDay].label}
          </Button>
          <Button size="md" className="menu-icon-action" disabled={switching} onClick={() => game?.openGarage()}>
            <GiHomeGarage aria-hidden="true"/> Garage
          </Button>
          <Button size="lg" variant="primary" className="menu-icon-action" disabled={switching} onClick={() => game?.startRace()} autoFocus>
            <GiCheckeredFlag aria-hidden="true"/> {settings.mode === 'drift' ? 'Start drifting' : 'Race'}
          </Button>
        </div>
      </div>

      {showRaceSetup && <RaceSetup onClose={() => setShowRaceSetup(false)} />}
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
    </div>
  )
}

/** Name, class, rank and stats of the current build. Shared by menu and garage. */
export function CarCard() {
  const name = useGame((s) => s.carName)
  // Mid-swap the engine still has the old car; name the incoming one, like the picker and specs do.
  const switching = useGame((s) => s.carSwitching)
  const build = useGame((s) => s.build)
  const carId = useGame((s) => s.settings.car)
  const stock = getCar(carId).stats
  const stats = buildStats(build, stock)
  const rank = performanceRank(build, stock)
  return (
    <div className="car-card">
      <div className="car-card__head">
        <ClassBadge value={carClass(rank)} size="lg" />
        <div>
          <div className="car-card__name">{switching ? getCar(carId).name : name || 'Loading…'}</div>
          <div className="car-card__rank">
            <span className="eyebrow">Rank</span> <b>{rank}</b>
          </div>
        </div>
      </div>
      <CarSpecsStrip carId={carId} />
      <StatBar label="Power" value={stats.power} />
      <StatBar label="Grip" value={stats.grip} />
      <StatBar label="Handling" value={stats.handling} />
      <StatBar label="Braking" value={stats.braking} />
    </div>
  )
}

/** Stock power, 0–100, top speed and drivetrain, the numbers a car card leads with. */
function CarSpecsStrip({ carId }: { carId: string }) {
  const s = getCar(carId).specs
  const tiles: [string, string, string][] = [
    ['Power', s.powerHp.toLocaleString(), 'hp'],
    ['0–100', s.zeroToHundred.toFixed(1), 's'],
    ['Top', String(s.topSpeedKmh), 'km/h'],
    ['Drive', s.drivetrain, ''],
  ]
  return (
    <dl className="car-specs" aria-label="Stock specifications">
      {tiles.map(([label, value, unit]) => (
        <div key={label} className="car-specs__tile">
          <dt>{label}</dt>
          <dd>
            {value}
            {unit && <small>{unit}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Mode tiles: the current one lit, the rest locked with a "Soon" tag until they're built. */
const modeIcons = { quick: GiCheckeredFlag, timeTrial: GiStopwatch, drift: GiRaceCar, freeRoam: GiRoad }

function ModeSelect() {
  const mode = useGame(s => s.settings.mode)
  const update = useGame(s => s.updateSettings)
  const switching = useGame(s => s.trackSwitching)
  return (
    <div className="mode-select">
      <div className="mode-select__grid" role="radiogroup" aria-label="Game mode">
        {GAME_MODES.map((m) => {
          const Icon = modeIcons[m.id]
          return <button
            key={m.id}
            role="radio"
            aria-checked={m.id === mode}
            disabled={!m.available || switching}
            onClick={() => { if (m.id === 'quick' || m.id === 'drift') update({mode: m.id, ...(m.id === 'drift' ? {track: 'drift-park'} : {})}) }}
            className={m.id === mode ? 'on' : ''}
            title={m.available ? m.blurb : `${m.blurb}: coming soon`}
          >
            <span className="mode-select__content"><Icon className="mode-select__icon" aria-hidden="true" focusable="false"/><span className="mode-select__text">{m.name}{m.id === mode && <small className="mode-select__description">{m.blurb}</small>}</span></span>
            {!m.available && <i>Soon</i>}
          </button>
        })}
      </div>
    </div>
  )
}

/** Open the circuit browser without starting a track download. */
function TrackPicker() {
  const [open, setOpen] = useState(false)
  const trackName = useGame((s) => s.trackName)
  const trackId = useGame((s) => s.settings.track)
  const loading = useGame((s) => s.trackSwitching)
  const progress = useGame((s) => s.loadProgress)
  const preview = trackPreviews[trackId as keyof typeof trackPreviews]
  return <>
    <button className="menu-track" disabled={loading} aria-busy={loading} onClick={() => setOpen(true)} aria-label={`Choose circuit: ${trackName}`}>
      <span className="menu-track__map" aria-hidden="true"><TrackAerial id={preview ? trackId : 'nurburgring'} /></span>
      <span className="menu-track__details">
        <span className="eyebrow">Selected circuit <span aria-hidden="true">↗</span></span>
        <span className="menu-track__name">{trackName}</span>
        <span className="menu-track__meta">{loading ? `Loading circuit · ${Math.round(progress * 100)}%` : <>{preview?.lengthKm ?? '—'} km per lap <i>/</i> Change circuit</>}</span>
      </span>
    </button>
    {open && <TrackSelection onClose={() => setOpen(false)} />}
  </>
}
