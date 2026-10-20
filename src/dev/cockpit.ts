import * as THREE from 'three'
import { Renderer } from '../engine/Renderer'
import { backend } from '../engine/backend'
import { AssetManager } from '../engine/AssetManager'
import { CarLivery } from '../vehicles/CarLivery'
import { DEFAULT_BUILD } from '../vehicles/CarBuild'
import { CockpitRig } from '../vehicles/CockpitRig'
import { cockpitProfile, sanitizeCockpit } from '../vehicles/CockpitConfig'
import { rigCarModel, type CarModel } from '../vehicles/CarModel'
import { resolveVehicleConfig, type VehicleConfig } from '../vehicles/VehicleConfig'
import { getCar } from '../vehicles/carRegistry'
import { ChaseCamera } from '../camera/ChaseCamera'

const renderer = new Renderer(document.querySelector('#view')!,new URLSearchParams(location.search).get('renderer')==='webgpu'?'webgpu':'webgl')
await renderer.init();renderer.applyQuality('low',false)
const assets=new AssetManager(), scene=renderer.scene, camera=new ChaseCamera(renderer.camera)
camera.mode='cockpit'
const car=document.querySelector<HTMLSelectElement>('#car')!, quality=document.querySelector<HTMLSelectElement>('#quality')!
const input=(id:string)=>document.querySelector<HTMLInputElement>('#'+id)!
const status=document.querySelector('output')!, night=input('night')
const light=new THREE.HemisphereLight(0xffffff,0x3e4c35,2), sun=new THREE.DirectionalLight(0xffefdf,2.5)
sun.position.set(-15,40,20);scene.add(light,sun)
const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,400),new THREE.MeshStandardMaterial({color:0x536249,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.03;scene.add(ground)
const road=new THREE.Mesh(new THREE.PlaneGeometry(14,300),new THREE.MeshStandardMaterial({color:0x30353c,roughness:.9}));road.rotation.x=-Math.PI/2;scene.add(road)
for(const x of [-6.8,6.8]){const line=new THREE.Mesh(new THREE.PlaneGeometry(.15,300),new THREE.MeshBasicMaterial({color:0xffffff}));line.rotation.x=-Math.PI/2;line.position.set(x,.005,0);scene.add(line)}
for(let i=0;i<12;i++){const box=new THREE.Mesh(new THREE.BoxGeometry(3,8,3),new THREE.MeshStandardMaterial({color:i%2?0x667565:0x78858f}));box.position.set(i%2?15:-15,4,15+i*13);scene.add(box)}
let model:CarModel|null=null,livery:CarLivery|null=null,config:VehicleConfig,loading=false
async function load(){
  if(loading)return
  loading=true;car.disabled=quality.disabled=true
  livery?.dispose();model?.cockpit?.dispose();model?.root.removeFromParent()
  model=null;status.textContent='Loading cockpit…'
  try{
    const entry=getCar(car.value),url=quality.value==='low'?entry.modelUrlLow??entry.modelUrl:entry.modelUrl
    const [root,json]=await Promise.all([assets.loadModel(url),assets.loadJson<Partial<VehicleConfig>>(entry.configUrl)])
    config=resolveVehicleConfig(json??undefined);model=rigCarModel(root,config)
    for(const w of config.wheels)model.wheels[w.id].pivot.position.set(w.position[0],w.position[1]-config.suspension.restLength,w.position[2])
    model.cockpit=new CockpitRig(model);livery=new CarLivery(model);livery.apply(DEFAULT_BUILD);scene.add(model.root)
    camera.cockpitCar=entry.id;camera.snap();input('height').max=String(cockpitProfile(entry.id).maxHeight)
  }finally{loading=false;car.disabled=quality.disabled=false}
}
car.onchange=()=>void load();quality.onchange=()=>void load()
document.querySelector('#camera')!.addEventListener('click',e=>{camera.mode=camera.mode==='cockpit'?'chase':'cockpit';(e.target as HTMLElement).textContent=camera.mode==='cockpit'?'Chase view':'Cockpit view'})
await load()
let previous=performance.now(),report=0
function render(now:number){
  const dt=Math.min((now-previous)/1000,.05);previous=now
  const dark=night.checked;scene.background=new THREE.Color(dark?0x071321:0xb1cbdc);light.intensity=dark?.12:2;sun.intensity=dark?.12:2.5
  if(model&&!loading){
    const steer=Number(input('steer').value),rpm=Number(input('rpm').value),speed=Number(input('speed').value)
    model.cockpit?.update(steer,rpm,speed,3,config.engine.redlineRpm,dt)
    for(const w of config.wheels)if(w.steered)model.wheels[w.id].pivot.rotation.y=steer
    camera.cockpitAdjustment=sanitizeCockpit({height:Number(input('height').value),distance:Number(input('distance').value),fov:Number(input('fov').value)},car.value)
    camera.update(model.root,speed,dt,0,undefined,0,model.body)
  }
  renderer.setViewOpacity(camera.viewOpacity)
  renderer.render()
  if(now-report>500&&model&&!loading){report=now;status.textContent=`${backend.kind} · ${car.value} · ${quality.value} · ${camera.mode}\n${renderer.drawCalls} draws / ${renderer.renderer.info.render.triangles} triangles · ${model.cockpit?.reusedWheel?'stock wheel isolated':'original supplemental wheel'}\n${input('speed').value} km/h · ${input('rpm').value} RPM · gear 3 · ${night.checked?'night':'day'}\nNo persisted settings changed.`}
  requestAnimationFrame(render)
}
requestAnimationFrame(render)
window.addEventListener('pagehide',()=>{livery?.dispose();model?.cockpit?.dispose();assets.dispose();renderer.dispose()},{once:true})
