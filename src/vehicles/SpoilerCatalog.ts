/** Stable part IDs persisted in each car's garage build. */
export const SPOILERS = [
  {id:'wing-01',name:'Street',description:'Clean raised blade'},
  {id:'wing-02',name:'Lip',description:'Low, one-piece profile'},
  {id:'wing-03',name:'Sport',description:'Compact twin mounts'},
  {id:'wing-04',name:'Club',description:'Sculpted endplates'},
  {id:'wing-05',name:'Touring',description:'Tall swept profile'},
  {id:'wing-06',name:'Aero',description:'Wide, curved blade'},
  {id:'wing-07',name:'Sprint',description:'Angular race profile'},
  {id:'wing-08',name:'Track',description:'High twin supports'},
  {id:'wing-09',name:'Blade',description:'Low swept supports'},
  {id:'wing-10',name:'Extreme',description:'Oversized competition wing'},
] as const
export type SpoilerId = 'stock' | typeof SPOILERS[number]['id']
export type SpoilerFinish = 'carbon' | 'paint' | 'custom'
export type SpoilerPattern = 'none' | 'center' | 'twin' | 'edges' | 'diagonal'
/** Planar UV coverage on the blade; independent of car livery and mounting hardware. */
export function spoilerStripe(pattern:SpoilerPattern,u:number,v:number,width:number):boolean {
  if(pattern==='center')return Math.abs(u-.5)<width/2
  if(pattern==='twin')return Math.abs(u-(.5-width))<width/3||Math.abs(u-(.5+width))<width/3
  if(pattern==='edges')return Math.abs(u-.1)<width/2||Math.abs(u-.9)<width/2
  if(pattern==='diagonal')return ((u+v*.22)% .25)<width/2
  return false
}
export const SPOILER_URL = '/models/parts/spoilers/spoilers.glb'
export function sanitizeSpoiler(value:unknown): SpoilerId {
  return SPOILERS.some(s=>s.id===value) ? value as SpoilerId : 'stock'
}
/** Feet touch the rear deck, in body-local metres. Width scales the whole part uniformly. */
export const SPOILER_FIT: Record<string,{position:readonly[number,number,number];width:number}> = {
  porsche911:{position:[0,.90,-1.87],width:1.62},
  koenigsegg:{position:[0,.79,-1.64],width:1.72},
  bmw:{position:[0,.87,-2.16],width:1.62},
  diablo:{position:[0,.87,-1.95],width:1.6},
  amg:{position:[0,.95,-1.95],width:1.7},
  charger:{position:[0,.92,-2.45],width:1.7},
}
