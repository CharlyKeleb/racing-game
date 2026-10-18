import { useEffect, useRef, useState } from 'react'
import { TIME_PRESETS } from '../world/timeOfDay'
import { TRACKS } from '../world/tracks'
import previews from './trackPreviews.json'
import { useGame } from './hooks'
import { Button } from './kit'
import { TrackAerial } from './TrackAerial'

const details: Record<string, { location: string; character: string; description: string }> = {
  'drift-park': {location: 'Drift playground', character: 'Hairpins / Linked slides', description: 'A purpose-built drift park with tight hairpins, sweeping transitions and a wide practice apron. Keep it sideways and link your slides.'},
  nurburgring: { location: 'Germany', character: 'Elevation / Fast sections', description: 'Commit through sweeping bends, manage the elevation changes and find your braking points.' },
  singapore: { location: 'Singapore', character: 'Street circuit / Walls close', description: 'Thread the walls round Marina Bay: tight 90° corners, two hairpins at the junction and no run-off to save you.' },
  'test-circuit': { location: 'Papaya proving grounds', character: 'Flat / Technical', description: 'A compact circuit for learning your car. Link the corners, refine your line and build confidence.' },
}

export function Circuit({ id }: { id: string }) {
  const { points } = previews[id as keyof typeof previews]
  const xs = points.map(p => p[0]), zs = points.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const scale = Math.min(440 / Math.max(1, maxX-minX), 300 / Math.max(1, maxZ-minZ))
  const projected = points.map(([x,z]) => [250+(x-(minX+maxX)/2)*scale, 180+(z-(minZ+maxZ)/2)*scale])
  const outline = projected.map(p=>p.join(',')).join(' ')
  return <svg viewBox="0 0 500 360" role="img" aria-label={`${TRACKS.find(t=>t.id===id)?.name} circuit outline`}>
    <polygon className="circuit-shadow" points={outline}/>
    <polygon className="circuit-line" points={outline}/>
    <circle cx={projected[0][0]} cy={projected[0][1]} r="6" className="circuit-grid"/>
  </svg>
}

/** Browsing is local; only confirmation changes the track and starts loading. */
export function TrackSelection({ onClose }: { onClose(): void }) {
  const current = useGame(s=>s.settings.track)
  const settings = useGame(s=>s.settings)
  const update = useGame(s=>s.updateSettings)
  const [selected,setSelected] = useState(current)
  const [view,setView] = useState<'outline'|'aerial'>('aerial')
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(()=>{dialog.current?.showModal()},[])
  const track = TRACKS.find(t=>t.id===selected) ?? TRACKS[0]
  const detail = details[track.id]
  const index = TRACKS.indexOf(track)
  return <dialog className="track-select" ref={dialog} onClose={onClose} aria-labelledby="track-select-title">
    <header className="track-select__header">
      <div><span className="eyebrow">{settings.mode === 'drift' ? 'Drift Challenge' : 'Quick Race'} / Location</span><h1 id="track-select-title">Choose your circuit<span>.</span></h1></div>
      <Button size="sm" variant="ghost" onClick={()=>dialog.current?.close()}>Back</Button>
    </header>
    <div className="track-select__body">
      <nav className="track-select__list" aria-label="Available circuits">
        <span className="eyebrow">{String(TRACKS.length).padStart(2,'0')} circuits available</span>
        {TRACKS.map((t,i)=><button key={t.id} className={`track-option ${selected===t.id?'is-selected':''}`} onClick={()=>setSelected(t.id)} aria-pressed={selected===t.id}>
          <span className="track-option__number">0{i+1}</span>
          <span className="track-option__text"><small>{details[t.id].location}</small><b>{t.name}</b><span>{previews[t.id as keyof typeof previews].lengthKm} km <i> / </i> {t.id===current?'Current circuit':'Circuit'}</span></span>
          <span className="track-option__arrow" aria-hidden="true">↗</span>
        </button>)}
        <p className="track-select__hint">Choose a circuit to preview it.<br/>Your car and race setup stay with you.</p>
      </nav>
      <section className="track-select__detail" aria-label="Selected circuit preview">
        <div className="track-select__map"><span className="track-select__watermark" aria-hidden="true">0{index+1}</span><div className="track-select__view" role="group" aria-label="Track preview view"><button aria-pressed={view==='aerial'} onClick={()=>setView('aerial')}>Aerial</button><button aria-pressed={view==='outline'} onClick={()=>setView('outline')}>Outline</button></div>{view==='aerial'?<TrackAerial id={track.id}/>:<Circuit key={track.id} id={track.id}/ >}<span className="track-select__legend"><i/> Start / finish</span></div>
        <div className="track-select__info"><span className="eyebrow">{detail.location}</span><h2>{track.name}</h2><p>{detail.description}</p>
          <dl className="track-select__stats"><div><dt>Lap distance</dt><dd>{previews[track.id as keyof typeof previews].lengthKm}<small>km</small></dd></div><div><dt>Character</dt><dd className="track-select__character">{detail.character}</dd></div></dl>
        </div>
      </section>
    </div>
    <footer className="track-select__footer"><div className="track-select__race-context"><span className="eyebrow">Your race</span><span>{settings.mode === 'drift' ? '2-minute solo run' : <>{settings.laps} {settings.laps===1?'lap':'laps'} <i>/</i> {(Number(previews[track.id as keyof typeof previews].lengthKm)*settings.laps).toFixed(2)} km</>} <i>/</i> {TIME_PRESETS[settings.timeOfDay].label}</span></div><Button variant="primary" size="lg" onClick={()=>{dialog.current?.close();if(selected!==current)update({track:selected})}}>{selected===current?'Keep this circuit':'Select circuit'} <span aria-hidden="true">→</span></Button></footer>
  </dialog>
}
