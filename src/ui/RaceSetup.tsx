import { DRIFT_EVENTS, driftEvent, type DriftEventId } from '../racing/driftEvents'
import { useEffect, useRef } from 'react'
import { AI_DIFFICULTIES, type AiDifficulty } from '../racing/AiProfiles'
import { TIME_PRESETS, type TimeOfDay } from '../world/timeOfDay'
import type { Weather } from '../stores/gameStore'
import { useGame } from './hooks'
import { Button, Panel, Segmented } from './kit'

/** Native modal supplies focus trapping, Escape and focus restoration. */
export function RaceSetup({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const settings = useGame((s) => s.settings)
  const event=driftEvent(settings.driftEvent)
  const update = useGame((s) => s.updateSettings)
  useEffect(() => { dialog.current?.showModal() }, [])
  return (
    <dialog ref={dialog} className="race-setup" aria-labelledby="race-setup-title" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close() }}>
      <Panel>
        <span className="eyebrow">{settings.mode === 'drift' ? 'Drift Challenge' : 'Quick Race'}</span>
        <h2 id="race-setup-title" className="ui-panel__title">{settings.mode === 'drift' ? 'Drift setup' : 'Race setup'}</h2>
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
        <p className="race-setup__note">{settings.mode === 'drift' ? 'Follow the route and pass every gate. Link slides to build ×5. Hit the cyan clipping zones for a 1.75× bonus. Clean transitions earn bonus points. Wall hits, spins, leaving the asphalt and resets lose your chain. Straighten up for 2.5 seconds to bank.' : settings.opponents > 0 ? AI_DIFFICULTIES[settings.difficulty].description : "Solo practice, with no rivals on the circuit."} Your setup is saved.</p>
        <Button variant="primary" onClick={() => dialog.current?.close()}>Done</Button>
      </Panel>
    </dialog>
  )
}
