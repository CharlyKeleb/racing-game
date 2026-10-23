import { useStore } from 'zustand'
import { onlineRaceStore } from './multiplayer/onlineRaceStore'
import { ControllerNavigation } from './ui/ControllerNavigation'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { Game } from './engine/Game'
import { gameStore } from './stores/gameStore'
import { GameContext } from './ui/GameContext'
import { useGame, useTelemetry } from './ui/hooks'
import { Narration } from './ui/Narration'
import { MainMenu } from './ui/MainMenu'
import { isTouchDevice } from './engine/device'

const OnlineRaceHud = lazy(() => import('./ui/OnlineRaceHud').then(module => ({ default: module.OnlineRaceHud })))
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
  // An ended Time Trial session has no finish line cinematic: straight to its results.
  const trialEnded = useTelemetry(s => s.trialEnded)
  const phase = useGame((s) => s.phase)
  const onlineMenu = useStore(onlineRaceStore, s => s.menuOpen)
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
      <ControllerNavigation phase={phase === 'online' && onlineMenu ? 'paused' : phase} />
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
        {(phase === 'menu' || phase === 'garage') && <MainMenu />}
        <Narration />
        <Suspense fallback={<div className="boot" role="status">Loading…</div>}>
          {phase === 'online' && <OnlineRaceHud />}
          {phase === 'intro' && <RaceIntro />}
          {(phase === 'countdown' || phase === 'racing' || phase === 'paused') && <Hud />}
          {(phase === 'countdown' || phase === 'racing') && touch && <TouchControls />}
          {phase === 'paused' && <PauseMenu />}
          {phase === 'finished' && (finishProgress < 1 && !trialEnded ? <RaceFinish /> : <Results />)}
        </Suspense>
      </div>
    </GameContext.Provider>
  )
}
