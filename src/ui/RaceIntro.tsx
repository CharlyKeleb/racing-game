import { useGameInstance } from './GameContext'
import { useGame, useTelemetry } from './hooks'
import { Button } from './kit'

export function RaceIntro() {
  const game = useGameInstance()
  const track = useGame(s=>s.trackName)
  const car = useGame(s=>s.carName)
  const laps = useGame(s=>s.settings.laps)
  const progress = useTelemetry(s=>s.introProgress)
  const field = useTelemetry(s=>s.standings)
  const shot = useTelemetry(s=>s.introShot)
  return <section className="race-intro" aria-label="Race introduction">
    <div className="race-intro__bar race-intro__bar--top" />
    <div className="race-intro__copy" key={shot}>
      <span className="eyebrow">Quick Race / {laps} {laps === 1 ? 'lap' : 'laps'} / {field.length} {field.length === 1 ? 'driver' : 'drivers'}</span>
      <h1>{shot === 0 ? track : shot === 1 ? car : 'Take your position'}<i>.</i></h1>
      <p>{shot === 0 ? 'Meet the grid.' : shot === 1 ? 'Your car. Your race.' : 'Eyes forward. The field is ahead.'}</p>
    </div>
    <ol className="race-intro__grid" aria-label="Starting grid">{field.map(s=><li key={s.id} className={s.player ? 'is-player' : ''}><b>P{s.position}</b><span>{s.name.split(' · ')[0]}</span></li>)}</ol>
    <Button className="race-intro__skip" variant="ghost" onClick={()=>game?.skipRaceIntro()}>Skip intro <kbd>Enter</kbd></Button>
    <div className="race-intro__bar race-intro__bar--bottom"><div style={{transform:`scaleX(${Math.max(0,Math.min(1,progress))})`}} /></div>
  </section>
}
