import { useEffect, useRef } from 'react'
import { AI_DIFFICULTIES, type AiDifficulty } from '../racing/AiProfiles'
import { TIME_PRESETS, type TimeOfDay } from '../world/timeOfDay'
import { useGame } from './hooks'
import { Button, Panel, Segmented } from './kit'

/** Native modal supplies focus trapping, Escape and focus restoration. */
export function RaceSetup({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const settings = useGame((s) => s.settings)
  const update = useGame((s) => s.updateSettings)
  useEffect(() => { dialog.current?.showModal() }, [])
  return (
    <dialog ref={dialog} className="race-setup" aria-labelledby="race-setup-title" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close() }}>
      <Panel>
        <span className="eyebrow">Quick Race</span>
        <h2 id="race-setup-title" className="ui-panel__title">Race setup</h2>
        <Segmented<number> label="Laps" value={settings.laps} options={[[1, '1'], [3, '3'], [5, '5']]} onPick={(laps) => update({ laps })} />
        <Segmented<number> label="Opponents" value={settings.opponents} options={[[0, 'Solo'], [1, 'Duel'], [3, 'Grid of 4']]} onPick={(opponents) => update({ opponents })} />
        {settings.opponents > 0 && <Segmented<AiDifficulty> label="Rival difficulty" value={settings.difficulty} options={Object.entries(AI_DIFFICULTIES).map(([id, d]) => [id as AiDifficulty, d.label])} onPick={(difficulty) => update({ difficulty })} />}
        <Segmented<TimeOfDay> label="Time of day" value={settings.timeOfDay}
          options={(Object.keys(TIME_PRESETS) as TimeOfDay[]).map((id) => [id, TIME_PRESETS[id].label])}
          onPick={(timeOfDay) => update({ timeOfDay })} />
        <p className="race-setup__note">{settings.opponents > 0 ? AI_DIFFICULTIES[settings.difficulty].description : "Solo practice, with no rivals on the circuit."} Your setup is saved.</p>
        <Button variant="primary" onClick={() => dialog.current?.close()}>Done</Button>
      </Panel>
    </dialog>
  )
}
