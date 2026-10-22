import {createRoot} from 'react-dom/client'
import * as THREE from 'three'
import App from '../App'
import {gameStore} from '../stores/gameStore'
import type {Vehicle} from '../vehicles/Vehicle'
import '../index.css'

const query=new URLSearchParams(location.search)
gameStore.setState({settings:{...gameStore.getState().settings,mode:'quick',track:'test-circuit',camera:'cockpit',opponents:3,laps:1,quality:'low',postfx:false,renderer:query.get('renderer')==='webgpu'?'webgpu':'webgl',proximityRadar:true,spotterVisual:true,spotterAudio:query.has('sound')}})
createRoot(document.querySelector('#root')!).render(<App/> )
// Explicit development-only controlled passes using the real car bodies and production HUD.
let scenario='Live',elapsed=0
const bar=document.createElement('nav');bar.setAttribute('aria-label','Proximity scenarios')
bar.style.cssText='position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;gap:4px;background:#101c2fe8;padding:6px;font:12px system-ui'
for(const name of ['Live','Left pass','Right pass','Both','Rear','Clear']){const button=document.createElement('button');button.textContent=name;button.onclick=()=>{scenario=name;elapsed=0};bar.append(button)}
document.body.append(bar)
const offset=new THREE.Vector3(),forward=new THREE.Vector3(),rotation=new THREE.Quaternion()
const interval=setInterval(()=>{
  const game=(window as unknown as {__game?:{vehicle:Vehicle;opponents:{vehicle:Vehicle}[]}}).__game
  if(!game||gameStore.getState().phase!=='racing'||scenario==='Live')return
  elapsed+=.05
  const root=game.vehicle.model.root,p=root.position,q=root.quaternion,heading=Math.atan2(2*(q.w*q.y+q.x*q.z),1-2*(q.y*q.y+q.x*q.x))
  forward.set(Math.sin(heading),0,Math.cos(heading));rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,heading)
  game.opponents.forEach((opponent,i)=>{
    let side=0,along=60+i*12,closing=0
    if(scenario==='Both'&&i<2){side=i===0?3:-3;along=0}
    else if((scenario==='Left pass'||scenario==='Right pass')&&i===0){side=scenario==='Left pass'?3:-3;along=-14+Math.min(elapsed,8)*4;closing=4}
    else if(scenario==='Rear'&&i===0){side=.5;along=-20;closing=10}
    offset.set(p.x+forward.z*side+forward.x*along,p.y,p.z-forward.x*side+forward.z*along)
    opponent.vehicle.body.setTranslation(offset,true);opponent.vehicle.body.setRotation(rotation,true)
    opponent.vehicle.body.setLinvel({x:game.vehicle.motion.velocity.x+forward.x*closing,y:0,z:game.vehicle.motion.velocity.z+forward.z*closing},true)
  })
},50)
window.addEventListener('pagehide',()=>clearInterval(interval),{once:true})
