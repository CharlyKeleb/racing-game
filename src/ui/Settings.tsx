import { CockpitSettings } from './CockpitSettings'
import type { TrackLook } from '../world/TrackLook'
import { Help } from './Help'
import { useEffect, useRef, useState } from 'react'
import { GiGears, GiSteeringWheel, GiSpeaker, GiGamepad, GiComputerFan } from 'react-icons/gi'
import type { RendererKind } from '../engine/backend'
import type { CameraMode, QualityPreset } from '../stores/gameStore'
import { TIME_PRESETS, type TimeOfDay } from '../world/timeOfDay'
import { useGame } from './hooks'
import { Button, Segmented } from './kit'
import { SettingChoices, SettingScene } from './SettingChoices'

const sections = [
  { id: 'graphics', label: 'Graphics', icon: GiComputerFan, hint: 'Balance detail and performance.' },
  { id: 'driving', label: 'Driving', icon: GiSteeringWheel, hint: 'Set your view and race preferences.' },
  { id: 'audio', label: 'Audio', icon: GiSpeaker, hint: 'Find the right volume for your engine.' },
  { id: 'controls', label: 'Controls', icon: GiGamepad, hint: 'Everything you need behind the wheel.' },
] as const

/** Top-layer modal: previews and other menu layers cannot paint over it. */
export function SettingsDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="settings-dialog" aria-label="Settings" onClose={onClose}>
    <Settings onClose={() => dialog.current?.close()} />
  </dialog>
}

export function Settings({ onClose }: { onClose?: () => void }) {
  const settings = useGame((s) => s.settings)
  const update = useGame((s) => s.updateSettings)
  const [section, setSection] = useState<typeof sections[number]['id']>('graphics')
  const active = sections.find(s => s.id === section)!
  return <section className="settings">
    <header className="settings__header"><div><span className="eyebrow">Make it yours</span><h2><GiGears aria-hidden="true"/>Settings</h2></div>
      {onClose && <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close settings">Close ×</Button>}
    </header>
    <div className="settings__body">
      <nav className="settings__nav" aria-label="Settings categories">
        {sections.map(s => <button key={s.id} aria-pressed={section === s.id} onClick={() => setSection(s.id)}><s.icon aria-hidden="true"/><span>{s.label}</span></button>)}
      </nav>
      <div className="settings__content" key={section}>
        <span className="eyebrow">{active.label}</span><p className="settings__hint">{active.hint}</p>
        {section === 'graphics' && <>
          <Segmented<TrackLook> label="Track appearance" value={settings.trackLook} options={[[ 'default','Track default'],['road-focus','Road focus']]} onPick={trackLook=>update({trackLook})}/>
          <p className="settings__help">Road focus darkens neutral asphalt and softens terrain colours on every circuit. Markings, signs and lights stay readable.</p>
          <SettingChoices<QualityPreset> preview={quality=><SettingScene quality={quality}/>} label="Visual quality" value={settings.quality} options={[[ 'low','Low'],['medium','Medium'],['high','High']]} onPick={quality=>update({quality})}/>
          <p className="settings__help">Illustrative previews. Low favors speed; High adds richer lighting and detail.</p>
          <SettingChoices<number> preview={v=><SettingScene effects={v===1}/>} label="Post effects" value={settings.postfx?1:0} options={[[1,'On'],[0,'Off']]} onPick={v=>update({postfx:v===1})}/>
          <Segmented<RendererKind> help label="Renderer" value={settings.renderer} options={[['webgl','WebGL'],['webgpu','WebGPU (beta)']]} onPick={renderer=>{ if (renderer === settings.renderer) return; update({renderer}); window.location.reload() }}/>
          <p className="settings__help">WebGPU is a trial: GPU particles, falls back to WebGL where it isn't supported. Switching reloads the game.</p>
        </>}
        {section === 'driving' && <>
          <label className="ui-field settings__volume">
            <span className="ui-field__label">Motion blur <em>{Math.round(settings.motionBlur * 100)}%</em></span>
            <input aria-label="Motion blur" className="ui-range" type="range" min={0} max={1} step={.05} value={settings.motionBlur} onChange={e=>update({motionBlur:Number(e.target.value)})}/>
            <span className="settings__help">Speed-scaled road and wheel blur. Your car body and HUD stay sharp. Set to zero to turn off; requires Post effects.</span>
          </label>
          <Segmented<number> label="Camera movement" value={settings.cameraMotion?1:0} options={[[1,'On'],[0,'Off']]} onPick={v=>update({cameraMotion:v===1})}/>
          <p className="settings__help">Camera movement controls extra head motion, shake and view fades. Reduced-motion preference disables these too.</p>
          <SettingChoices<CameraMode> preview={camera=><SettingScene cockpit={camera==='cockpit'}/>} label="Camera" value={settings.camera} options={[[ 'chase','Chase'],['cockpit','Cockpit']]} onPick={camera=>update({camera})}/>
          {settings.camera === 'cockpit' && <CockpitSettings/>}
          <Segmented<number> label="Proximity radar" value={settings.proximityRadar?1:0} options={[[1,'On'],[0,'Off']]} onPick={v=>update({proximityRadar:v===1})}/>
          <Segmented<number> label="Spotter text" value={settings.spotterVisual?1:0} options={[[1,'On'],[0,'Off']]} onPick={v=>update({spotterVisual:v===1})}/>
          <p className="settings__help">Nearby rivals relative to your car. Amber marks a closing car; red marks overlap. Spotter text confirms left, right and clear.</p>
          <SettingChoices<TimeOfDay> preview={time=><SettingScene time={time}/>} label="Time of day" value={settings.timeOfDay} options={(Object.keys(TIME_PRESETS) as TimeOfDay[]).map(id=>[id,TIME_PRESETS[id].label])} onPick={timeOfDay=>update({timeOfDay})}/>
          <Segmented<number> help label="Laps" value={settings.laps} options={[[1,'1'],[3,'3'],[5,'5']]} onPick={laps=>update({laps})}/>
        </>}
        {section === 'audio' && <>
          <Segmented<number> label="Spotter sounds" value={settings.spotterAudio?1:0} options={[[1,'On'],[0,'Off']]} onPick={v=>update({spotterAudio:v===1})}/>
          <p className="settings__help">Directional tones for a car alongside; a rising tone when clear. Independent of the radar and text.</p>
          <label className="ui-field settings__volume">
            <span className="ui-field__label">Trackside ambience <em>{Math.round(settings.tracksideVolume * 100)}%</em></span>
            <input aria-label="Trackside ambience volume" className="ui-range" type="range" min={0} max={1} step={.05} value={settings.tracksideVolume} onChange={e=>update({tracksideVolume:Number(e.target.value)})}/>
            <span className="settings__help">Flags, wind and pit equipment on supported circuits. Zero mutes trackside ambience.</span>
          </label>
          <label className="ui-field settings__volume">
            <span className="ui-field__label">Master volume <Help label="Master volume">Adjusts all game sound, including the engine, tires, effects, menu music and garage ambience. Zero mutes the game.</Help><em>{Math.round(settings.masterVolume*100)}%</em></span>
            <input aria-label="Master volume" className="ui-range" type="range" min={0} max={1} step={.05} value={settings.masterVolume} onChange={e=>update({masterVolume:Number(e.target.value)})}/>
            <span className="settings__help">Engine, tires, effects, menu music and garage ambience.</span>
          </label>
          <Segmented<number> label="Menu music" value={settings.menuMusic?1:0} options={[[1,'On'],[0,'Off']]} onPick={v=>update({menuMusic:v===1})}/>
        </>}
        {section === 'controls' && <dl className="settings__controls">
          <div><dt>Accelerate</dt><dd><kbd>W</kbd> / <kbd>↑</kbd></dd></div>
          <div><dt>Brake / reverse</dt><dd><kbd>S</kbd> / <kbd>↓</kbd></dd></div>
          <div><dt>Steer</dt><dd><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd></dd></div>
          <div><dt>Handbrake</dt><dd><kbd>Space</kbd></dd></div>
          <div><dt>Nitro</dt><dd><kbd>Shift</kbd></dd></div>
          <div><dt>Camera / reset / pause</dt><dd><kbd>C</kbd> <kbd>R</kbd> <kbd>Esc</kbd></dd></div>
          <div><dt>Look back (hold)</dt><dd><kbd>B</kbd> / gamepad R3</dd></div>
        </dl>}
        {section === 'controls' && <p className="settings__help">Drift: tap brake or handbrake while turning. Tap nitro again on the cue for a perfect boost. Gamepads are supported.</p>}
      </div>
    </div>
    <footer className="settings__footer"><span>Changes save automatically</span>{onClose && <Button variant="primary" onClick={onClose}>Done</Button>}</footer>
  </section>
}
