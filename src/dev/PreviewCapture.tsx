import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { TRACKS } from '../world/tracks'
import { AerialCapture } from './AerialCapture'
import './preview-capture.css'

export function CapturePage() {
  const [id,setId] = useState(TRACKS[0].id)
  const [saved,setSaved] = useState('')
  const save = async () => {
    const image=document.querySelector<HTMLImageElement>('.track-aerial__image')
    if (!image) {setSaved('Wait for the aerial to finish rendering.');return}
    try {
      const data=await (await fetch(image.src)).blob()
      const response=await fetch(`/__save-track-preview?id=${encodeURIComponent(id)}`,{method:'POST',body:data})
      const text=await response.text()
      if(!response.ok || text!==`Saved ${id}.webp`)throw new Error('Run npm run capture:previews to enable saving.')
      setSaved(text)
    } catch(error) {setSaved(error instanceof Error?error.message:'Save failed')}
  }
  return <main>
    <header><div><h1>Track preview capture</h1><p>1600 × 1040 WebP · blue route and start/finish baked in · no game UI</p></div>
      <label>Track <select value={id} onChange={e=>{setId(e.target.value);setSaved('')}}>{TRACKS.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <button onClick={()=>void save()}>Save to project</button>
      <button onClick={()=>void document.documentElement.requestFullscreen()}>Fullscreen</button>
    </header>
    <section aria-label="Aerial capture" className="capture-stage"><AerialCapture key={id} id={id}/></section>
    <footer><strong role="status">{saved}</strong> Download the image and place it in <code>public/previews/tracks/{id}.webp</code>. See <code>docs/TRACK_PREVIEWS.md</code>.</footer>
  </main>
}

// This tooling is served by Vite dev only; it is not a production build entry.
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<CapturePage/> )
