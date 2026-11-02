import { getCar, selectableCars } from '../vehicles/carRegistry'
import { useGameInstance } from './GameContext'
import { useGame } from './hooks'
import { Chevron } from './kit'

/**
 * ‹ Car name › for the menu and garage. Stepping makes the current car drive
 * off and the next one drive in (Game.cycleCar); disabled while that plays.
 */
export function CarPicker({ className = '' }: { className?: string }) {
  const game = useGameInstance()
  const name = useGame((s) => s.carName)
  const switching = useGame((s) => s.carSwitching || s.trackSwitching)
  const carId = useGame((s) => s.settings.car)
  const cars = selectableCars()
  if (cars.length < 2) return null
  const index = Math.max(0, cars.findIndex((c) => c.id === carId))
  return (
    <div className={`car-picker ${className}`} aria-live="polite">
      <Chevron dir="left" label="Previous car" disabled={switching} onClick={() => game?.cycleCar(-1)} />
      <div className="car-picker__name">
        <span className="eyebrow">
          Car {index + 1}/{cars.length}
        </span>
        <b>{switching ? cars[index].name : name}</b>
      </div>
      <Chevron dir="right" label="Next car" disabled={switching} onClick={() => game?.cycleCar(1)} />
    </div>
  )
}

/**
 * The incoming car's download and preparation while the garage swaps cars. Fades in only after a
 * moment, so a car that's already loaded just drives in.
 */
export function CarLoadBar() {
  const switching = useGame((s) => s.carSwitching)
  const progress = useGame((s) => s.carLoadProgress)
  const carId = useGame((s) => s.settings.car)
  if (!switching || progress >= 1) return null
  const percent = Math.round(progress * 100)
  return (
    <div className="car-load" role="progressbar" aria-label={`Loading ${getCar(carId).name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <span className="car-load__label"><span>Loading {getCar(carId).name}</span><b>{percent}%</b></span>
      <span className="car-load__track"><i style={{ transform: `scaleX(${progress})` }} /></span>
    </div>
  )
}
