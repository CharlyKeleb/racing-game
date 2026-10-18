import * as THREE from 'three'
export interface ClipZone { x:number; y:number; z:number; radius:number; name:string }
/** Pick spaced corners from the actual loaded road, so zones also fit other circuits. */
export function clippingZones(line:readonly {x:number;y:number;z:number}[]):ClipZone[] {
  const n=line.length
  if(n<20)return []
  const step=Math.min(7,Math.floor(n/8))
  const ranked=line.map((p,i)=>{
    const a=line[(i-step+n)%n],b=line[(i+step)%n]
    const ax=p.x-a.x,az=p.z-a.z,bx=b.x-p.x,bz=b.z-p.z
    return {p, bend:1-(ax*bx+az*bz)/Math.max(.001,Math.hypot(ax,az)*Math.hypot(bx,bz))}
  }).sort((a,b)=>b.bend-a.bend)
  const zones:ClipZone[]=[]
  for(const {p} of ranked) {
    if(Math.hypot(p.x-line[0].x,p.z-line[0].z)<35 || zones.some(z=>Math.hypot(z.x-p.x,z.z-p.z)<55))continue
    zones.push({x:p.x,y:p.y,z:p.z,radius:12,name:`CLIP ${String(zones.length+1).padStart(2,'0')}`})
    if(zones.length===3)break
  }
  return zones
}
export class DriftZones {
  readonly group=new THREE.Group()
  readonly zones:ClipZone[]
  private readonly gates:THREE.Group[]=[]
  private materials:THREE.MeshBasicMaterial[]=[]
  constructor(line:readonly THREE.Vector3[],checkpoints:readonly {position:THREE.Vector3;tangent:THREE.Vector3;radius:number}[] = []) {
    this.zones=clippingZones(line)
    for(const zone of this.zones) {
      const material=new THREE.MeshBasicMaterial({color:0x21e5df,transparent:true,opacity:.45,side:THREE.DoubleSide,depthWrite:false,toneMapped:false})
      this.materials.push(material)
      const ring=new THREE.Mesh(new THREE.RingGeometry(zone.radius-.35,zone.radius,64),material)
      ring.rotation.x=-Math.PI/2;ring.position.set(zone.x,zone.y+.045,zone.z)
      this.group.add(ring)
      for(const side of [-1,1]) {
        const beacon=new THREE.Mesh(new THREE.BoxGeometry(.15,2.4,.15),material)
        beacon.position.set(zone.x+side*zone.radius,zone.y+1.2,zone.z)
        this.group.add(beacon)
      }
    }
    for(const cp of checkpoints) {
      const gate=new THREE.Group()
      gate.position.copy(cp.position);gate.position.y+=.06
      gate.rotation.y=Math.atan2(cp.tangent.x,cp.tangent.z)
      const material=new THREE.MeshBasicMaterial({color:0xffd447,transparent:true,opacity:.8,depthWrite:false,toneMapped:false})
      this.materials.push(material)
      const width=Math.min(cp.radius,9)
      for(const side of [-1,1]) {
        const pole=new THREE.Mesh(new THREE.BoxGeometry(.14,3,.14),material)
        pole.position.set(side*width,1.5,0);gate.add(pole)
      }
      const stripe=new THREE.Mesh(new THREE.PlaneGeometry(width*2,.3),material)
      stripe.rotation.x=-Math.PI/2;gate.add(stripe)
      gate.visible=false;this.gates.push(gate);this.group.add(gate)
    }
  }
  at(x:number,z:number):ClipZone|undefined { return this.zones.find(p=>Math.hypot(x-p.x,z-p.z)<=p.radius) }
  update(x:number,z:number,visible:boolean,nextGate=0):void {
    this.group.visible=visible
    if(!visible)return
    this.gates.forEach((gate,i)=>{gate.visible=i===nextGate})
    this.zones.forEach((p,i)=>{const active=Math.hypot(x-p.x,z-p.z)<=p.radius;this.materials[i].opacity=active?.85:.4;this.materials[i].color.setHex(active?0xffce46:0x21e5df)})
  }
  dispose():void {
    this.group.removeFromParent()
    this.group.traverse(o=>{if(o instanceof THREE.Mesh)o.geometry.dispose()})
    this.materials.forEach(m=>m.dispose())
  }
}
