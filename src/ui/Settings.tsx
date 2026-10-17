import type { QualityPreset } from '../stores/gameStore'
import { useGame } from './hooks'
import { Button, Panel, Segmented } from './kit'

export function Settings({ onClose }: { onClose?: () => void }) {
  const settings = useGame((s) => s.settings)
  const update = useGame((s) => s.updateSettings)
  return (
    <Panel title="Settings" className="settings">
      <Segmented<QualityPreset>
        label="Quality"
        value={settings.quality}
        options={[
          ['low', 'Low'],
          ['medium', 'Medium'],
          ['high', 'High'],
        ]}
        onPick={(quality) => update({ quality })}
      />
      <Segmented<number>
        label="Laps"
        value={settings.laps}
        options={[
          [1, '1'],
          [3, '3'],
          [5, '5'],
        ]}
        onPick={(laps) => update({ laps })}
      />
      <Segmented<number>
        label="Post FX"
        value={settings.postfx ? 1 : 0}
        options={[
          [1, 'On'],
          [0, 'Off'],
        ]}
        onPick={(v) => update({ postfx: v === 1 })}
      />
      <label className="ui-field">
        <span className="ui-field__label">
          Volume <em>{Math.round(settings.masterVolume * 100)}</em>
        </span>
        <input
          className="ui-range"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.masterVolume}
          onChange={(e) => update({ masterVolume: Number(e.target.value) })}
        />
      </label>
      <ul className="controls">
        <li><kbd>W</kbd><kbd>↑</kbd> throttle · <kbd>S</kbd><kbd>↓</kbd> brake / reverse</li>
        <li><kbd>A</kbd><kbd>D</kbd> steer · <kbd>Space</kbd> handbrake · <kbd>Shift</kbd> nitro</li>
        <li><kbd>C</kbd> camera · <kbd>R</kbd> reset · <kbd>Esc</kbd> pause · gamepad supported</li>
      </ul>
      {onClose && (
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      )}
    </Panel>
  )
}
