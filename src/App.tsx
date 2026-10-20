import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Game } from './engine/Game'
import { gameStore } from './stores/gameStore'
import { GameContext } from './ui/GameContext'
import { useGame, useTelemetry } from './ui/hooks'
import { MainMenu } from './ui/MainMenu'
import { isTouchDevice } from './engine/device'

const Garage = lazy(() => import('./ui/Garage').then(module => ({ default: module.Garage })))
const Hud = lazy(() => import('./ui/Hud').then(module => ({ default: module.Hud })))
const PauseMenu = lazy(() => import('./ui/PauseMenu').then(module => ({ default: module.PauseMenu })))
const RaceIntro = lazy(() => import('./ui/RaceIntro').then(module => ({ default: module.RaceIntro })))
const RaceFinish = lazy(() => import('./ui/RaceFinish').then(module => ({ default: module.RaceFinish })))
const Results = lazy(() => import('./ui/Results').then(module => ({ default: module.Results })))
const TouchControls = lazy(() => import('./ui/TouchControls').then(module => ({ default: module.TouchControls })))

const touch = isTouchDevice()

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [game, setGame] = useState<Game | null>(null)
  const finishProgress = useTelemetry(s => s.finishProgress)
  const phase = useGame((s) => s.phase)
  const error = useGame((s) => s.error)
  const progress = useGame((s) => s.loadProgress)
  const trackName = useGame((s) => s.trackName)

  useEffect(() => {
    let cancelled = false
    let instance: Game | undefined
    void import('./engine/Game').then(async ({ Game }) => {
      if (cancelled) return
      instance = new Game(containerRef.current!)
      setGame(instance)
      await instance.init()
      if (cancelled) return
      // Warm only the imminent race overlays after the first useful menu.
      void Promise.all([import('./ui/Hud'), import('./ui/RaceIntro'), import('./ui/RaceFinish'), import('./ui/Results'),
        ...(touch ? [import('./ui/TouchControls')] : [])]).catch(() => {})
    }).catch((err: unknown) => {
      if (cancelled) return
      console.error(err)
      gameStore.getState().setError(err instanceof Error ? err.message : String(err))
    })
    return () => { cancelled = true; instance?.dispose() }
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
        <Suspense fallback={<div className="boot" role="status">Loading…</div>}>
          {phase === 'garage' && <Garage />}
          {phase === 'intro' && <RaceIntro />}
          {(phase === 'countdown' || phase === 'racing' || phase === 'paused') && <Hud />}
          {(phase === 'countdown' || phase === 'racing') && touch && <TouchControls />}
          {phase === 'paused' && <PauseMenu />}
          {phase === 'finished' && (finishProgress < 1 ? <RaceFinish /> : <Results />)}
        </Suspense>
      </div>
    </GameContext.Provider>
  )
}
