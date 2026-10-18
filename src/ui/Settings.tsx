import { useStore } from 'zustand'
import { controllerStore } from '../stores/controllerStore'
import { Help } from './Help'
import { useEffect, useRef, useState } from 'react'
import { GiGears, GiSteeringWheel, GiSpeaker, GiGamepad, GiComputerFan } from 'react-icons/gi'
import type { CameraMode, QualityPreset } from '../stores/gameStore'
import { TIME_PRESETS, type TimeOfDay } from '../world/timeOfDay'
import { useGame } from './hooks'
import { Button, Segmented } from './kit'
import { SettingChoices, SettingScene } from './SettingChoices'

const sections = [
  { id: 'graphics', label: 'Graphics', icon: GiComputerFan, hint: 'Balance detail and performance.' },
  { id: 'driving', label: 'Driving', icon: GiSteeringWheel, hint: 'Set your view and race preferences.' },
  { id: 'audio', label: 'Audio', icon: GiSpeaker, hint: 'Find the right volume for your engine.' },
  { id: 'controls', label: 'Keyboard', icon: GiSteeringWheel, hint: 'Keyboard driving controls.' },
  { id: 'controller', label: 'Controller', icon: GiGamepad, hint: 'Connect your controller and get ready to drive.' },
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
  const controllerConnected = useStore(controllerStore, s => s.connected)
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
          <SettingChoices<QualityPreset> preview={quality=><SettingScene quality={quality}/>} label="Visual quality" value={settings.quality} options={[[ 'low','Low'],['medium','Medium'],['high','High']]} onPick={quality=>update({quality})}/>
          <p className="settings__help">Illustrative previews. Low favors speed; High adds richer lighting and detail.</p>
          <SettingChoices<number> preview={v=><SettingScene effects={v===1}/>} label="Post effects" value={settings.postfx?1:0} options={[[1,'On'],[0,'Off']]} onPick={v=>update({postfx:v===1})}/>
        </>}
        {section === 'driving' && <>
          <SettingChoices<CameraMode> preview={camera=><SettingScene cockpit={camera==='cockpit'}/>} label="Camera" value={settings.camera} options={[[ 'chase','Chase'],['cockpit','Cockpit']]} onPick={camera=>update({camera})}/>
          <SettingChoices<TimeOfDay> preview={time=><SettingScene time={time}/>} label="Time of day" value={settings.timeOfDay} options={(Object.keys(TIME_PRESETS) as TimeOfDay[]).map(id=>[id,TIME_PRESETS[id].label])} onPick={timeOfDay=>update({timeOfDay})}/>
          <Segmented<number> help label="Laps" value={settings.laps} options={[[1,'1'],[3,'3'],[5,'5']]} onPick={laps=>update({laps})}/>
        </>}
        {section === 'audio' && <label className="ui-field settings__volume">
          <span className="ui-field__label">Master volume <Help label="Master volume">Adjusts all game sound, including the engine, tires, effects and garage ambience. Zero mutes the game.</Help><em>{Math.round(settings.masterVolume*100)}%</em></span>
          <input aria-label="Master volume" className="ui-range" type="range" min={0} max={1} step={.05} value={settings.masterVolume} onChange={e=>update({masterVolume:Number(e.target.value)})}/>
          <span className="settings__help">Engine, tires, effects and garage ambience.</span>
        </label>}
        {section === 'controller' && <>
          <h3 role="status">{controllerConnected ? 'Controller connected' : 'No controller connected'}</h3>
          <p className="settings__help">Plug in with USB, or pair your controller in your device’s Bluetooth settings. Return to the game and press any controller button to activate it.</p>
          {!controllerConnected && <p className="settings__help">Keep this game window focused. If your controller isn’t detected, reconnect it and press a button again.</p>}
          <dl className="settings__controls">
            <div><dt>Steer</dt><dd>Left stick</dd></div>
            <div><dt>Accelerate / brake</dt><dd>RT / LT · R2 / L2</dd></div>
            <div><dt>Handbrake / skip intro</dt><dd>A · Cross</dd></div>
            <div><dt>Nitro</dt><dd>X or RB · Square or R1</dd></div>
            <div><dt>Camera</dt><dd>Y · Triangle</dd></div>
            <div><dt>Reset car</dt><dd>B · Circle</dd></div>
            <div><dt>Pause / resume</dt><dd>Menu · Options</dd></div>
            <div><dt>Menus</dt><dd>Stick / D-pad · A / Cross select · B / Circle back</dd></div>
          </dl>
          <p className="settings__help">Xbox, PlayStation and compatible controllers with the standard browser mapping. Drift: tap brake or handbrake while turning. Tap nitro again on the cue for a perfect boost.</p>
        </>}
        {section === 'controls' && <dl className="settings__controls">
          <div><dt>Accelerate</dt><dd><kbd>W</kbd> / <kbd>↑</kbd></dd></div>
          <div><dt>Brake / reverse</dt><dd><kbd>S</kbd> / <kbd>↓</kbd></dd></div>
          <div><dt>Steer</dt><dd><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd></dd></div>
          <div><dt>Handbrake</dt><dd><kbd>Space</kbd></dd></div>
          <div><dt>Nitro</dt><dd><kbd>Shift</kbd></dd></div>
          <div><dt>Camera / reset / pause</dt><dd><kbd>C</kbd> <kbd>R</kbd> <kbd>Esc</kbd></dd></div>
        </dl>}
      </div>
    </div>
    <footer className="settings__footer"><span>Changes save automatically</span>{onClose && <Button variant="primary" onClick={onClose}>Done</Button>}</footer>
  </section>
}
