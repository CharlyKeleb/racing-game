import { selectableCars } from '../vehicles/carRegistry'
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
