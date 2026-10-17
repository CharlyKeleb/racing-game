import { useGameInstance } from './GameContext'
import { Button, Panel } from './kit'
import { Settings } from './Settings'

export function PauseMenu() {
  const game = useGameInstance()
  return (
    <div className="screen screen--center">
      <div className="pause">
        <Panel title="Paused" className="pause__main">
          <Button variant="primary" size="lg" onClick={() => game?.togglePause()} autoFocus>
            Resume
          </Button>
          <Button onClick={() => game?.startRace()}>Restart</Button>
          <Button variant="ghost" onClick={() => game?.quitToMenu()}>
            Quit to menu
          </Button>
        </Panel>
        <Settings />
      </div>
    </div>
  )
}
