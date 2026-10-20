import {createRoot} from 'react-dom/client'
import {Hud} from '../ui/Hud'
import {TouchControls} from '../ui/TouchControls'
import {gameStore} from '../stores/gameStore'
import {telemetryStore} from '../stores/telemetryStore'
import {proximityStore} from '../stores/proximityStore'
import {ProximityRadar,type AwarenessCar} from '../racing/ProximityRadar'
import '../index.css'
const query=new URLSearchParams(location.search),touch=query.has('touch')
const car=(id:number,x:number,z=0,vz=30):AwarenessCar=>({id,x,y:.7,z,fx:0,fz:1,vx:0,vz,halfWidth:1,halfLength:2.2,route:100+z})
const radar=new ProximityRadar(),player=car(0,0),rivals=query.get('case')==='rear'?[car(1,0,-20,40)]:[car(1,3),car(2,-3)]
for(let i=0;i<20;i++)radar.update(player,rivals,1000,.05,()=>true)
gameStore.setState({phase:'racing',settings:{...gameStore.getState().settings,proximityRadar:true,spotterVisual:true}})
telemetryStore.setState({speedKmh:115,rpm:5400,gear:3,fps:60,lap:1,totalMs:5000,standings:[1,2,3,4].map((id,i)=>({id,player:id===1,name:id===1?'You':`Rival ${id}`,position:i+1,finishMs:null,gapMeters:i*3,gapLaps:0,gapMs:null}))})
proximityStore.setState({radar,frame:1})
createRoot(document.querySelector('#root')!).render(<><div className={touch?'overlay overlay--touch':'overlay'}><Hud/>{touch&&<TouchControls/>}</div><span className="fixture-label">HUD layout fixture · {touch?'touch':'desktop'}</span></>)
