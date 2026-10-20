import { cockpitProfile, DEFAULT_COCKPIT_ADJUSTMENT, sanitizeCockpit, type CockpitAdjustment } from '../vehicles/CockpitConfig'
import { getCar } from '../vehicles/carRegistry'
import { useGame } from './hooks'
import { Button } from './kit'

export function CockpitSettings() {
  const settings = useGame(s=>s.settings), update = useGame(s=>s.updateSettings)
  const car = settings.car, profile = cockpitProfile(car), value = settings.cockpits[car] ?? DEFAULT_COCKPIT_ADJUSTMENT
  const change = (key: keyof CockpitAdjustment, next: number) => update({cockpits:{...settings.cockpits,[car]:sanitizeCockpit({...value,[key]:next},car)}})
  return <fieldset className="cockpit-settings"><legend>Cockpit seating · {getCar(car).name}</legend>
    <p className="settings__help">Saved for this car. Adjust from pause, then resume to check the view.</p>
    {([
      ['height','Seat height',-.04,profile.maxHeight,.005,100,'cm'],
      ['distance','Seat forward / back',-.1,.08,.005,100,'cm'],
      ['fov','Field of view',-10,12,1,1,'°'],
      ['yaw','Look left / right',-25,25,1,1,'°'],
      ['pitch','View tilt',-8,4,1,1,'°'],
    ] as const).map(([key,label,min,max,step,scale,unit])=><label key={key} className="ui-field settings__volume">
      <span className="ui-field__label">{label}<em>{key==='fov'?profile.fov+value.fov:Math.round(value[key]*scale*10)/10}{unit}</em></span>
      <input className="ui-range" aria-label={label} type="range" min={min} max={max} step={step} value={value[key]} onChange={e=>change(key,Number(e.target.value))}/>
    </label>)}
    <Button size="sm" onClick={()=>update({cockpits:{...settings.cockpits,[car]:{...DEFAULT_COCKPIT_ADJUSTMENT}}})}>Reset cockpit view</Button>
  </fieldset>
}
