import { useGameInstance } from './GameContext'
import { useGame } from './hooks'
import { Button, Panel } from './kit'
import { Settings } from './Settings'

export function PauseMenu() {
  const game = useGameInstance()
  const mode = useGame(s => s.settings.mode)
  const leaveToGarage = () => { game?.quitToMenu(); game?.openGarage() }
  return (
    <div className="screen screen--center">
      <div className="pause">
        <Panel title="Paused" className="pause__main">
          <Button variant="primary" size="lg" onClick={() => game?.togglePause()} autoFocus>
            Resume
          </Button>
          {mode === 'freeRoam' ? <>
            <Button onClick={() => game?.restartSession()}>Back to start</Button>
            <Button onClick={leaveToGarage}>Garage</Button>
          </> : mode === 'timeTrial' ? <>
            <Button onClick={() => game?.restartSession()}>Restart run <kbd>T</kbd></Button>
            <Button onClick={() => game?.endTrialSession()}>End session</Button>
          </> : (
            <Button onClick={() => game?.startRace()}>Restart</Button>
          )}
          <Button variant="ghost" onClick={() => game?.quitToMenu()}>
            Quit to menu
          </Button>
        </Panel>
        <Settings />
      </div>
    </div>
  )
}
