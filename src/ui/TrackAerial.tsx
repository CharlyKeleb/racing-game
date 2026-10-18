import { useEffect, useState } from 'react'
import { getTrack } from '../world/tracks'

const loaded = new Set<string>()
const previewUrl = (id:string) => `/previews/tracks/${encodeURIComponent(id)}.webp`
type Frame = {id:string;url:string}

/** Static build-time capture only: no geometry, physics or extra renderer in the menu. */
export function TrackAerial({ id }: { id:string }) {
  const [frames,setFrames] = useState<{current?:Frame;previous?:Frame}>(()=>({current:loaded.has(id)?{id,url:previewUrl(id)}:undefined}))
  const [failedId,setFailedId] = useState<string|null>(null)
  const loading = frames.current?.id !== id
  const error = failedId === id
  useEffect(()=>{
    let cancelled = false
    const image = new Image()
    image.src = previewUrl(id)
    void image.decode().then(()=>{
      if (cancelled) return
      loaded.add(id)
      setFailedId(null)
      setFrames(previous=>previous.current?.id===id?previous:{previous:previous.current,current:{id,url:previewUrl(id)}})
    }).catch(()=>{if (!cancelled) setFailedId(id)})
    return ()=>{cancelled=true}
  },[id])
  return <div className={`track-aerial ${loading?'is-loading':''}`} aria-busy={loading&&!error}>
    {frames.previous && <img className="track-aerial__previous" src={frames.previous.url} alt="" aria-hidden="true"/>}
    {frames.current && <img key={frames.current.url} className="track-aerial__image" src={frames.current.url} alt={`Bird's-eye view of ${getTrack(frames.current.id).name}`}/>}
    {(loading||error)&&<span className="track-aerial__status" role="status">{error?'Aerial unavailable — switch to Outline':`Loading ${getTrack(id).name} preview…`}</span>}
  </div>
}
