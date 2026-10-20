import { DRIFT_EVENTS, driftEvent, type DriftEventId } from '../racing/driftEvents'
import { useEffect, useRef } from 'react'
import { AI_DIFFICULTIES, type AiDifficulty } from '../racing/AiProfiles'
import { TIME_PRESETS, type TimeOfDay } from '../world/timeOfDay'
import type { Weather } from '../stores/gameStore'
import { useGame } from './hooks'
import { gameMode } from '../racing/gameModes'
import { formatTime } from '../racing/LapTimer'
import { readTrialRecord, trialBuildKey } from '../racing/TimeTrial'
import { Button, Panel, Segmented } from './kit'

/** Native modal supplies focus trapping, Escape and focus restoration. */
export function RaceSetup({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const settings = useGame((s) => s.settings)
  const event=driftEvent(settings.driftEvent)
  const update = useGame((s) => s.updateSettings)
  const build = useGame((s) => s.build)
  const personalBest = settings.mode === 'timeTrial' ? readTrialRecord(settings.track, settings.car, trialBuildKey(build))?.lapMs ?? null : null
  useEffect(() => { dialog.current?.showModal() }, [])
  return (
    <dialog ref={dialog} className="race-setup" aria-labelledby="race-setup-title" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close() }}>
      <Panel>
        <span className="eyebrow">{gameMode(settings.mode).name}</span>
        <h2 id="race-setup-title" className="ui-panel__title">{settings.mode === 'drift' ? 'Drift setup' : settings.mode === 'timeTrial' ? 'Time trial' : settings.mode === 'freeRoam' ? 'Free roam' : 'Race setup'}</h2>
        {settings.mode === 'timeTrial' && <div className="drift-setup-summary"><strong>Personal best {formatTime(personalBest)}</strong><span>This circuit · this car · this performance build</span><small>Unlimited laps against your best. Drive through every checkpoint arch: missing one or resetting voids the lap. <kbd>T</kbd> restarts.</small></div>}
        {settings.mode === 'freeRoam' && <>
          <Segmented<number> label="Speed and gear gauges" value={settings.roamHud?1:0} options={[[1,'Show'],[0,'Hide']]} onPick={v=>update({roamHud:v===1})}/>
          <Segmented<number> label="Route arrows" value={settings.roamGuide?1:0} options={[[1,'Show'],[0,'Hide']]} onPick={v=>update({roamGuide:v===1})}/>
        </>}
        {settings.mode === 'drift' && <>
          <Segmented<DriftEventId> label="Drift event" value={settings.driftEvent} options={Object.values(DRIFT_EVENTS).map(e=>[e.id,e.name])} onPick={driftEvent=>update({driftEvent})}/>
          <div className="drift-setup-summary"><strong>{event.name}</strong><span>{event.laps} scored {event.laps===1?'lap':'laps'} · No time limit · {event.minSpeed}+ km/h</span><small>{event.description}</small></div>
        </>}
        {settings.mode === 'quick' && <>
        <Segmented<number> label="Laps" value={settings.laps} options={[[1, '1'], [3, '3'], [5, '5']]} onPick={(laps) => update({ laps })} />
        <Segmented<number> label="Opponents" value={settings.opponents} options={[[0, 'Solo'], [1, 'Duel'], [3, 'Grid of 4']]} onPick={(opponents) => update({ opponents })} />
        {settings.opponents > 0 && <Segmented<AiDifficulty> label="Rival difficulty" value={settings.difficulty} options={Object.entries(AI_DIFFICULTIES).map(([id, d]) => [id as AiDifficulty, d.label])} onPick={(difficulty) => update({ difficulty })} />}
        </>}
        <Segmented<TimeOfDay> label="Time of day" value={settings.timeOfDay}
          options={(Object.keys(TIME_PRESETS) as TimeOfDay[]).map((id) => [id, TIME_PRESETS[id].label])}
          onPick={(timeOfDay) => update({ timeOfDay })} />
        <Segmented<Weather> help label="Weather" value={settings.weather} options={[['dry', 'Dry'], ['rain', 'Rain']]} onPick={(weather) => update({ weather })} />
        <p className="race-setup__note">{settings.mode === 'timeTrial' ? 'Solo, no rivals.' : settings.mode === 'freeRoam' ? 'No countdown, laps or finish. R puts you on the nearest checkpoint, T back at the start.' : settings.mode === 'drift' ? 'Follow the route and pass every gate. Link slides to build ×5. Hit the cyan clipping zones for a 1.75× bonus. Clean transitions earn bonus points. Wall hits, spins, leaving the asphalt and resets lose your chain. Straighten up for 2.5 seconds to bank.' : settings.opponents > 0 ? AI_DIFFICULTIES[settings.difficulty].description : "Solo practice, with no rivals on the circuit."} Your setup is saved.</p>
        <Button variant="primary" onClick={() => dialog.current?.close()}>Done</Button>
      </Panel>
    </dialog>
  )
}
