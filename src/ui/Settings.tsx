import type { QualityPreset } from '../stores/gameStore'
import { useGame } from './hooks'

export function Settings() {
  const settings = useGame((s) => s.settings)
  const update = useGame((s) => s.updateSettings)
  return (
    <div className="settings">
      <label>
        Quality
        <select value={settings.quality} onChange={(e) => update({ quality: e.target.value as QualityPreset })}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>
      <label>
        Post FX
        <input type="checkbox" checked={settings.postfx} onChange={(e) => update({ postfx: e.target.checked })} />
      </label>
      <label>
        Volume
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.masterVolume}
          onChange={(e) => update({ masterVolume: Number(e.target.value) })}
        />
      </label>
      <label>
        Laps
        <select value={settings.laps} onChange={(e) => update({ laps: Number(e.target.value) })}>
          {[1, 3, 5].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
