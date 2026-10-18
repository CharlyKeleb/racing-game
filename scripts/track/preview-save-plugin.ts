import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'
import { TRACKS } from '../../src/world/tracks.ts'

/** Explicit local capture endpoint, enabled only for the capture task. */
export function previewSavePlugin(): Plugin {
  return {
    name:'save-track-preview', apply:'serve',
    configureServer(server) {
      server.middlewares.use('/__save-track-preview',async(req,res,next)=>{
        if (req.method!=='POST') return next()
        if (req.headers.origin!==`http://${req.headers.host}`) {res.statusCode=403;res.end('Same-origin capture only');return}
        const id = new URL(req.url!,'http://localhost').searchParams.get('id')
        if (!id || !TRACKS.some(track=>track.id===id)) {res.statusCode=400;res.end('Unknown circuit');return}
        try {
          const parts:Buffer[]=[];let size=0
          for await(const part of req) {size+=part.length;if(size>5_000_000)throw new Error('Image too large');parts.push(part)}
          const data=Buffer.concat(parts)
          if(data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WEBP')throw new Error('Expected WebP')
          const dir=path.join(server.config.root,'public/previews/tracks')
          await mkdir(dir,{recursive:true});await writeFile(path.join(dir,`${id}.webp`),data)
          res.setHeader('Content-Type','text/plain; charset=utf-8')
          res.end(`Saved ${id}.webp`)
        }catch(error){res.statusCode=400;res.end(error instanceof Error?error.message:'Capture failed')}
      })
    },
  }
}
