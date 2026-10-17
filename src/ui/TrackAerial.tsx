import { useEffect, useState } from 'react'
import * as THREE from 'three'
import { AssetManager } from '../engine/AssetManager'
import { initRapier, PhysicsWorld } from '../engine/PhysicsWorld'
import { Track } from '../world/Track'
import { getTrack } from '../world/tracks'

const snapshots = new Map<string, string>()

/** Render an overhead still on demand, then release its WebGL context. */
export function TrackAerial({ id }: { id: string }) {
  const [frames, setFrames] = useState<{current?:{id:string;url:string};previous?:{id:string;url:string}}>(()=>({current:snapshots.has(id)?{id,url:snapshots.get(id)!}:undefined}))
  const [failedId, setFailedId] = useState<string | null>(null)
  const loading = frames.current?.id !== id
  const error = failedId === id
  useEffect(() => {
    let cancelled = false
    const scene = new THREE.Scene()
    const resources = new Set<THREE.Material>()
    let renderer: THREE.WebGLRenderer | undefined
    const dispose = () => {
      scene.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return
        o.geometry.dispose()
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) resources.add(material)
      })
      const textures = new Set<THREE.Texture>()
      for (const material of resources) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
        material.dispose()
      }
      textures.forEach(t => t.dispose())
      renderer?.dispose()
      renderer?.forceContextLoss()
    }
    void (async () => {
      if (snapshots.has(id)) return snapshots.get(id)!
      const def = getTrack(id)
      const assets = new AssetManager()
      scene.background = new THREE.Color('#729a99')
      scene.add(new THREE.HemisphereLight(0xdceeff, 0x425632, 2.4))
      const sun = new THREE.DirectionalLight(0xffe2b5, 3)
      sun.position.set(-500, 1000, 300)
      scene.add(sun)
      let bounds: THREE.Box3
      let route: THREE.Vector3[]
      if (def.kind === 'procedural') {
        await initRapier()
        if (cancelled) return
        const physics = new PhysicsWorld()
        try {
          const track = new Track(def, physics.world)
          scene.add(track.group)
          route = track.line.map(p=>p.clone())
          bounds = new THREE.Box3().setFromPoints(route)
        } finally { physics.dispose() }
      } else {
        const manifest = await assets.loadJson<{ materials: {low:string}; backdrop:string; line:[number,number,number][]; chunks:{lods:{url:string}[]}[] }>(def.manifestUrl)
        if (!manifest) throw new Error('Preview unavailable')
        if (cancelled) return
        const base = def.manifestUrl.slice(0, def.manifestUrl.lastIndexOf('/')+1)
        const library = await assets.loadGltf(base+manifest.materials.low)
        const materials = await library.parser.getDependencies('material') as THREE.Material[]
        materials.forEach(m=>resources.add(m))
        const byName = new Map(materials.map(m=>[m.name,m]))
        const vertex = new THREE.MeshStandardMaterial({vertexColors:true,roughness:1})
        resources.add(vertex)
        const urls = [manifest.backdrop,...manifest.chunks.map(c=>c.lods[0].url)]
        const worker = async () => {
          while (!cancelled && urls.length) {
            const gltf = await assets.loadGltf(base+urls.shift()!)
            gltf.scene.traverse(o=>{
              if (!(o instanceof THREE.Mesh)) return
              const stub = o.material as THREE.Material
              const material = byName.get(stub.name) ?? vertex
              resources.add(stub)
              o.material = material
            })
            scene.add(gltf.scene)
          }
        }
        const jobs = await Promise.allSettled([worker(),worker(),worker(),worker()])
        const failed = jobs.find(job=>job.status==='rejected')
        if (failed?.status==='rejected') throw failed.reason
        route = manifest.line.map(p=>new THREE.Vector3(...p))
        bounds = new THREE.Box3().setFromPoints(route)
      }
      if (cancelled) return
      const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3())
      const width = 1000, height = 650, aspect = width/height
      const span = Math.max(size.z*1.3, size.x/aspect*1.3, 100)
      const pixel = span / height
      // Dark edging keeps the cyan route legible against both grass and tarmac.
      const addRibbon = (halfWidth: number, color: number, order: number) => {
        const vertices: number[] = []
        for (let i=0;i<route!.length;i++) {
          const a=route![i], b=route![(i+1)%route!.length]
          const dx=b.x-a.x, dz=b.z-a.z, length=Math.hypot(dx,dz)
          if (!length) continue
          const nx=-dz/length*halfWidth, nz=dx/length*halfWidth
          vertices.push(a.x+nx,a.y+2,a.z+nz,a.x-nx,a.y+2,a.z-nz,b.x+nx,b.y+2,b.z+nz,
            b.x+nx,b.y+2,b.z+nz,a.x-nx,a.y+2,a.z-nz,b.x-nx,b.y+2,b.z-nz)
        }
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3))
        const mesh = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,depthTest:false,depthWrite:false,toneMapped:false}))
        mesh.renderOrder=order
        scene.add(mesh)
      }
      addRibbon(pixel*4,0x071321,100)
      addRibbon(pixel*2.3,0x19c3ff,101)
      // A high-contrast start/finish pin is sized in preview pixels on every circuit.
      for (const [radius,color,order] of [[9,0x071321,102],[6,0xffd533,103]]) {
        const marker = new THREE.Mesh(new THREE.CircleGeometry(pixel*radius,32),new THREE.MeshBasicMaterial({color,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}))
        marker.rotation.x=-Math.PI/2
        marker.position.copy(route![0])
        marker.position.y+=4
        marker.renderOrder=order
        scene.add(marker)
      }
      const camera = new THREE.OrthographicCamera(-span*aspect/2, span*aspect/2, span/2, -span/2, 1, 20000)
      camera.position.set(center.x, bounds.max.y+5000, center.z)
      camera.up.set(0,0,-1)
      camera.lookAt(center)
      renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true})
      renderer.setSize(width,height)
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.render(scene,camera)
      const url = renderer.domElement.toDataURL('image/webp',.9)
      snapshots.set(id,url)
      return url
    })().then(url=>{
      if (!cancelled && url) {
        setFailedId(null)
        setFrames(prev=>({previous:prev.current,current:{id,url}}))
      }
    }).catch(()=>{ if(!cancelled)setFailedId(id) }).finally(dispose)
    return ()=>{cancelled=true}
  },[id])
  return <div className={`track-aerial ${loading?'is-loading':''}`} aria-busy={loading && !error}>
    {frames.previous && <img className="track-aerial__previous" src={frames.previous.url} alt="" aria-hidden="true"/>}
    {frames.current && <img key={frames.current.url} className="track-aerial__image" src={frames.current.url} alt={`Bird's-eye view of ${getTrack(frames.current.id).name}`}/>}
    {(loading || error) && <span className="track-aerial__status" role="status">{error?'Aerial unavailable — switch to Outline':`Preparing ${getTrack(id).name} aerial…`}</span>}
  </div>
}
