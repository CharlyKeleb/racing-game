import { useGameInstance } from './GameContext'
import { useGame } from './hooks'
import { Settings } from './Settings'

export function MainMenu() {
  const game = useGameInstance()
  return (
    <div className="panel menu">
      <h1 className="title">
        RACING<span>/</span>GAME
      </h1>
      <p className="subtitle">Papaya Test Circuit · McLaren</p>
      <button className="primary" onClick={() => game?.startRace()} autoFocus>
        Start race
      </button>
      <Settings />
      <Controls />
    </div>
  )
}

function Controls() {
  const laps = useGame((s) => s.settings.laps)
  return (
    <ul className="controls">
      <li><kbd>W</kbd>/<kbd>↑</kbd> throttle · <kbd>S</kbd>/<kbd>↓</kbd> brake &amp; reverse</li>
      <li><kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> handbrake</li>
      <li><kbd>C</kbd> camera · <kbd>R</kbd> reset car · <kbd>Esc</kbd> pause</li>
      <li>Gamepad supported (RT/LT/left stick). {laps} laps.</li>
    </ul>
  )
}
