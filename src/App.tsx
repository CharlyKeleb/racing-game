import { useEffect, useRef, useState } from 'react'
import { Game } from './engine/Game'
import { gameStore } from './stores/gameStore'
import { GameContext } from './ui/GameContext'
import { Garage } from './ui/Garage'
import { Hud } from './ui/Hud'
import { useGame } from './ui/hooks'
import { MainMenu } from './ui/MainMenu'
import { PauseMenu } from './ui/PauseMenu'
import { Results } from './ui/Results'
import { TouchControls } from './ui/TouchControls'
import { isTouchDevice } from './engine/device'

const touch = isTouchDevice()

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [game, setGame] = useState<Game | null>(null)
  const phase = useGame((s) => s.phase)
  const error = useGame((s) => s.error)
  const progress = useGame((s) => s.loadProgress)
  const trackName = useGame((s) => s.trackName)

  useEffect(() => {
    const g = new Game(containerRef.current!)
    setGame(g)
    g.init().catch((err: unknown) => {
      console.error(err)
      gameStore.getState().setError(err instanceof Error ? err.message : String(err))
    })
    return () => g.dispose()
  }, [])

  return (
    <GameContext.Provider value={game}>
      <div className="viewport" ref={containerRef} />
      <div className={touch ? "overlay overlay--touch" : "overlay"}>
        {error && (
          <div className="boot-error">
            <div className="ui-panel">Failed to start: {error}</div>
          </div>
        )}
        {(phase === 'boot' || phase === 'loading') && !error && (
          <div className="boot">
            <div>
              <div className="logo">
                RACING<span>/</span>GAME
              </div>
              <span className="eyebrow">Loading {trackName}</span>
              <div className="boot-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ transform: `scaleX(${progress})` }} />
              </div>
            </div>
          </div>
        )}
        {phase === 'menu' && <MainMenu />}
        {phase === 'garage' && <Garage />}
        {(phase === 'countdown' || phase === 'racing' || phase === 'paused' || phase === 'finished') && <Hud />}
        {(phase === 'countdown' || phase === 'racing') && touch && <TouchControls />}
        {phase === 'paused' && <PauseMenu />}
        {phase === 'finished' && <Results />}
      </div>
    </GameContext.Provider>
  )
}
