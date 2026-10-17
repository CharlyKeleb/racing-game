import { useEffect, useState } from 'react'
import { useGameInstance } from './GameContext'
import { useGame } from './hooks'
import { Button } from './kit'

export function RevButton() {
  const game = useGameInstance()
  const switching = useGame((s) => s.carSwitching || s.trackSwitching)
  const [held, setHeld] = useState(false)
  const release = () => { setHeld(false); game?.revEngine(false) }
  useEffect(() => {
    const stop = () => { setHeld(false); game?.revEngine(false) }
    const visibility = () => { if (document.hidden) stop() }
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      game?.revEngine(false)
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [game])
  return <Button size="sm" className={`menu-rev ${held && !switching ? 'is-revving' : ''}`} disabled={switching}
    aria-label="Hold to rev engine"
    onPointerDown={(e) => {
      if (e.button !== 0) return
      e.currentTarget.setPointerCapture(e.pointerId)
      setHeld(true); game?.revEngine(true)
    }}
    onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
    onKeyDown={(e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return
      e.preventDefault()
      if (!e.repeat) { setHeld(true); game?.revEngine(true) }
    }}
    onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); release() } }}>
    {held && !switching ? 'Revving…' : 'Hold to rev'}
  </Button>
}
