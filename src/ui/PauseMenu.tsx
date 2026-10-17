import { useGameInstance } from './GameContext'
import { Settings } from './Settings'

export function PauseMenu() {
  const game = useGameInstance()
  return (
    <div className="panel menu">
      <h2>Paused</h2>
      <button className="primary" onClick={() => game?.togglePause()} autoFocus>
        Resume
      </button>
      <button onClick={() => game?.startRace()}>Restart</button>
      <button onClick={() => game?.quitToMenu()}>Quit to menu</button>
      <Settings />
    </div>
  )
}
