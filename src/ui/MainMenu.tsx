import { lobbyStore } from '../multiplayer/lobbyStore'
import { driftEvent } from '../racing/driftEvents'
import { AccountButton, AccountDialog } from './Account'
import { accountStore } from '../stores/accountStore'
import { GiCheckeredFlag, GiStopwatch, GiRaceCar, GiRoad, GiHomeGarage, GiGears, GiSteeringWheel, GiPathDistance } from 'react-icons/gi'
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react'
import { buildStats, carClass, DEFAULT_BUILD, performanceRank } from '../vehicles/CarBuild'
import { getCar, selectableCars } from '../vehicles/carRegistry'
import { GAME_MODES, gameMode, type GameModeId } from '../racing/gameModes'
import { formatTime } from '../racing/LapTimer'
import { readTrialRecord, trialBuildKey } from '../racing/TimeTrial'
import { useGameInstance } from './GameContext'
import { useGame } from './hooks'
import { CarLoadBar, CarPicker } from './CarPicker'
import { ClassBadge, StatBar } from './kit'
import { OrbitLayer } from './OrbitLayer'
import { RaceSetup } from './RaceSetup'
import { TrackSelection } from './TrackSelection'
import { TrackAerial } from './TrackAerial'
import trackPreviews from './trackPreviews.json'
import { RevButton } from './RevButton'
import { MenuMusicBar } from './MenuMusicBar'
import { TIME_PRESETS } from '../world/timeOfDay'

const OnlineLobby = lazy(() => import('./OnlineLobby').then(module => ({ default: module.OnlineLobby })))

const SettingsDialog = lazy(() => import('./Settings').then(module => ({ default: module.SettingsDialog })))
const GarageWorkshop = lazy(() => import('./Garage').then(module => ({ default: module.GarageWorkshop })))

/**
 * The festival hub (Forza Horizon / The Crew Motorfest / NFS): the showroom
 * car is the hero in the middle; tabs across the top (Q / E, like a pad's
 * bumpers) switch the right-hand column between the event mosaic, the car
 * list and the workshop; the car's identity sits bottom-left and key hints
 * along the bottom. The Garage tab is the garage phase (its camera framing),
 * shown in place: the hub stays mounted across both phases.
 */
type Tab = 'play' | 'cars' | 'garage'
const TAB_ORDER: Tab[] = ['play', 'cars', 'garage']

export function MainMenu() {
  const game = useGameInstance()
  const phase = useGame((s) => s.phase)
  const [picked, setPicked] = useState<Exclude<Tab, 'garage'>>('play')
  const tab: Tab = phase === 'garage' ? 'garage' : picked
  // A sign-in link that failed opens the account dialog, to say why.
  const [dialog, setDialog] = useState<'settings' | 'setup' | 'tracks' | 'account' | 'online' | null>(() => accountStore.getState().returnError ? 'account' : lobbyStore.getState().status === 'connected' || lobbyStore.getState().error ? 'online' : null)
  useEffect(() => {
    const check = () => {
      const s = accountStore.getState()
      if (s.status === 'signedIn' && s.profileStatus === 'ready' && !s.profile) setDialog('account')
    }
    check()
    return accountStore.subscribe(check)
  }, [])
  const switching = useGame((s) => s.carSwitching || s.trackSwitching)
  const carName = useGame((s) => s.carName)
  const carId = useGame((s) => s.settings.car)
  const go = (next: Tab) => {
    if (next === 'garage') { if (!switching) game?.openGarage(); return }
    game?.closeGarage()
    setPicked(next)
  }
  // Try immediately in case autoplay is allowed; otherwise the first click or
  // key in the menu brings up the garage's room tone and the soundtrack.
  useEffect(() => {
    if (!game) return
    game.unlockAudio()
    const start = () => game.unlockAudio()
    window.addEventListener('pointerdown', start, { once: true })
    window.addEventListener('keydown', start, { once: true })
    return () => {
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
    }
  }, [game])

  // Pad-style shortcuts while no dialog is open: Q / E tabs, ← / → cars, G garage, Esc out of it.
  useEffect(() => {
    if (dialog) return
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.code === 'KeyQ' || e.code === 'KeyE') go(TAB_ORDER[(TAB_ORDER.indexOf(tab) + (e.code === 'KeyE' ? 1 : TAB_ORDER.length - 1)) % TAB_ORDER.length])
      else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') game?.cycleCar(e.code === 'ArrowLeft' ? -1 : 1)
      else if (e.code === 'KeyG') go(tab === 'garage' ? 'play' : 'garage')
      else if (e.code === 'Escape' && tab === 'garage') go('play')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const tabs: { id: Tab | 'garage' | 'settings'; label: string; Icon: ComponentType<{ 'aria-hidden'?: boolean }> }[] = [
    { id: 'play', label: 'Play', Icon: GiCheckeredFlag },
    { id: 'cars', label: 'Cars', Icon: GiSteeringWheel },
    { id: 'garage', label: 'Garage', Icon: GiHomeGarage },
    { id: 'settings', label: 'Settings', Icon: GiGears },
  ]
  const pick = (id: (typeof tabs)[number]['id']) => {
    if (id === 'settings') setDialog((d) => (d === 'settings' ? null : 'settings'))
    else go(id)
  }

  return (
    <div className={`screen screen--menu hub hub--${tab}`}>
      <OrbitLayer />
      <div className="hub-banner" aria-hidden="true" key={carId}>{switching ? getCar(carId).name : carName}</div>
      <CarLoadBar />
      <header className="hub-top">
        <div className="logo">RACING<span>/</span>GAME</div>
        <nav className="hub-tabs" role="tablist" aria-label="Main menu">
          <kbd className="hub-key" aria-hidden="true">Q</kbd>
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} role="tab" aria-selected={id === tab} className={`hub-tab${id === tab ? ' on' : ''}`}
              disabled={id === 'garage' && switching} aria-expanded={id === 'settings' ? dialog === 'settings' : undefined}
              onClick={() => pick(id)}>
              <span><Icon aria-hidden />{label}</span>
            </button>
          ))}
          <kbd className="hub-key" aria-hidden="true">E</kbd>
        </nav>
        <AccountButton onOpen={() => setDialog('account')} />
      </header>

      {/* In the garage the workshop takes this rail, so nothing covers the car being inspected. */}
      {tab !== 'garage' && <aside className="hub-car">
        <CarPicker />
        <CarCard />
        <div className="hub-car__tools">
          <RevButton />
          <MenuMusicBar />
        </div>
      </aside>}

      <section className={`hub-panel${tab === 'garage' ? ' hub-panel--left' : ''}`} key={tab} aria-label={tab === 'play' ? 'Events' : tab === 'cars' ? 'Cars' : 'Garage'}>
        {tab === 'play' && <PlayMosaic onOnline={() => setDialog('online')} onSetup={() => setDialog('setup')} onTracks={() => setDialog('tracks')} />}
        {tab === 'cars' && <CarList />}
        {tab === 'garage' && <Suspense fallback={<div className="hub-loading" role="status">Opening the garage…</div>}><GarageWorkshop /></Suspense>}
      </section>

      <footer className="hub-hints" aria-hidden="true">
        <span><kbd>←</kbd><kbd>→</kbd> Car</span>
        <span><kbd>Q</kbd><kbd>E</kbd> Tabs</span>
        {tab === 'garage' ? <span><kbd>Esc</kbd> Back</span> : <span><kbd>G</kbd> Garage</span>}
        {tab === 'play' && <span><kbd>Enter</kbd> Go</span>}
        <span><kbd>Drag</kbd> Look around</span>
      </footer>

      {dialog === 'setup' && <RaceSetup onClose={() => setDialog(null)} />}
      {dialog === 'tracks' && <TrackSelection onClose={() => setDialog(null)} />}
      {dialog === 'account' && <AccountDialog onClose={() => setDialog(null)} />}
      {dialog === 'online' && <Suspense fallback={<div role="status">Opening online lobby…</div>}><OnlineLobby onClose={() => setDialog(null)} onAccount={() => setDialog('account')} /></Suspense>}
      {dialog === 'settings' && <Suspense fallback={<div role="status">Loading settings…</div>}><SettingsDialog onClose={() => setDialog(null)} /></Suspense>}
    </div>
  )
}

const START_LABELS: Record<GameModeId, string> = { quick: 'Race', timeTrial: 'Start trial', drift: 'Start drifting', freeRoam: 'Drive' }
const MODE_ICONS = { quick: GiCheckeredFlag, timeTrial: GiStopwatch, drift: GiRaceCar, freeRoam: GiRoad }

function setupLabel(mode: GameModeId, event: Parameters<typeof driftEvent>[0], laps: number, personalBest: number | null): string {
  if (mode === 'drift') return `Drift · ${driftEvent(event).name}`
  if (mode === 'timeTrial') return `PB ${formatTime(personalBest)}`
  if (mode === 'freeRoam') return 'No timer'
  return `${laps} ${laps === 1 ? 'lap' : 'laps'}`
}

/**
 * Horizon-style event mosaic: the selected mode is the big hero tile over its
 * circuit's aerial, with the start button; the other modes are colour-coded
 * tiles that select it; circuit and setup tiles open their dialogs.
 */
function PlayMosaic({ onSetup, onTracks, onOnline }: { onSetup(): void; onTracks(): void; onOnline(): void }) {
  const game = useGameInstance()
  const settings = useGame((s) => s.settings)
  const build = useGame((s) => s.build)
  const update = useGame((s) => s.updateSettings)
  const trackName = useGame((s) => s.trackName)
  const trackSwitching = useGame((s) => s.trackSwitching)
  const switching = useGame((s) => s.carSwitching || s.trackSwitching)
  const progress = useGame((s) => s.loadProgress)
  const mode = gameMode(settings.mode)
  const HeroIcon = MODE_ICONS[mode.id]
  const preview = trackPreviews[settings.track as keyof typeof trackPreviews]
  const personalBest = settings.mode === 'timeTrial' ? readTrialRecord(settings.track, settings.car, trialBuildKey(build))?.lapMs ?? null : null
  const conditions = `${TIME_PRESETS[settings.timeOfDay].label}${settings.weather === 'rain' ? ' · Rain' : ''}`
  return (
    <div className="hub-mosaic">
      <article className={`hub-hero hub-mode--${mode.id}`}>
        <div className="hub-hero__art" aria-hidden="true"><TrackAerial id={preview ? settings.track : 'nurburgring'} /></div>
        <div className="hub-hero__body">
          <span className="hub-eyebrow"><HeroIcon aria-hidden="true" /> {mode.blurb}</span>
          <h2 className="hub-hero__title">{mode.name}</h2>
          <p className="hub-hero__meta">
            <b>{trackName}</b>
            <span>{trackSwitching ? `Loading · ${Math.round(progress * 100)}%` : `${preview?.lengthKm ?? '—'} km · ${setupLabel(settings.mode, settings.driftEvent, settings.laps, personalBest)} · ${conditions}`}</span>
          </p>
          <button className="hub-go" disabled={switching} onClick={() => game?.startRace()} autoFocus>
            <span><GiCheckeredFlag aria-hidden="true" /> {START_LABELS[settings.mode]}</span>
            <kbd aria-hidden="true">Enter</kbd>
          </button>
        </div>
      </article>

      <button className="online-entry" onClick={onOnline}>
        <span><GiCheckeredFlag aria-hidden /><strong>Online lobby</strong></span><small>Private rooms · Race with a rival</small><b aria-hidden>↗</b>
      </button>

      <div className="hub-modes" role="radiogroup" aria-label="Game mode">
        {GAME_MODES.filter((m) => m.id !== mode.id).map((m) => {
          const Icon = MODE_ICONS[m.id]
          return (
            <button key={m.id} role="radio" aria-checked={false} className={`hub-tile hub-mode--${m.id}`} disabled={!m.available || trackSwitching}
              title={m.available ? m.blurb : `${m.blurb}: coming soon`}
              onClick={() => { if (m.available) update({ mode: m.id, ...(m.id === 'drift' ? { track: 'drift-park' } : {}) }) }}>
              <Icon className="hub-tile__icon" aria-hidden="true" />
              <Icon className="hub-tile__mark" aria-hidden="true" />
              <span className="hub-tile__name">{m.name}</span>
              <small>{m.available ? m.blurb : 'Soon'}</small>
            </button>
          )
        })}
      </div>

      <div className="hub-row">
        <button className="hub-tile hub-tile--wide" disabled={trackSwitching} onClick={onTracks} aria-label={`Choose circuit: ${trackName}`}>
          <GiPathDistance className="hub-tile__icon" aria-hidden="true" />
          <span className="hub-tile__name">Circuit</span>
          <small>{trackName}</small>
        </button>
        <button className="hub-tile hub-tile--wide" onClick={onSetup}>
          <GiGears className="hub-tile__icon" aria-hidden="true" />
          <span className="hub-tile__name">Setup</span>
          <small>{setupLabel(settings.mode, settings.driftEvent, settings.laps, personalBest)} · {conditions}</small>
        </button>
      </div>
    </div>
  )
}

/** Autoshow-style list: every car with its class and headline numbers; picking one drives it in. */
function CarList() {
  const carId = useGame((s) => s.settings.car)
  const update = useGame((s) => s.updateSettings)
  const switching = useGame((s) => s.carSwitching || s.trackSwitching)
  const builds = useGame((s) => s.builds)
  return (
    <div className="hub-cars" role="radiogroup" aria-label="Cars">
      {selectableCars().map((car) => {
        const rank = performanceRank(builds[car.id] ?? DEFAULT_BUILD, car.stats)
        return (
          <button key={car.id} role="radio" aria-checked={car.id === carId} className={`hub-carrow${car.id === carId ? ' on' : ''}`}
            disabled={switching} onClick={() => { if (car.id !== carId) update({ car: car.id }) }}>
            <ClassBadge value={carClass(rank)} />
            <span className="hub-carrow__name">{car.name}<small>{car.specs.drivetrain} · {car.specs.weightKg.toLocaleString()} kg</small></span>
            <span className="hub-carrow__num"><b>{car.specs.powerHp}</b> hp</span>
            <span className="hub-carrow__num"><b>{car.specs.topSpeedKmh}</b> km/h</span>
          </button>
        )
      })}
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
