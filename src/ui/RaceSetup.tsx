import { useEffect, useRef } from 'react'
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
        <Segmented<TimeOfDay> label="Time of day" value={settings.timeOfDay}
          options={(Object.keys(TIME_PRESETS) as TimeOfDay[]).map((id) => [id, TIME_PRESETS[id].label])}
          onPick={(timeOfDay) => update({ timeOfDay })} />
        <p className="race-setup__note">Your setup is saved for the next race.</p>
        <Button variant="primary" onClick={() => dialog.current?.close()}>Done</Button>
      </Panel>
    </dialog>
  )
}
