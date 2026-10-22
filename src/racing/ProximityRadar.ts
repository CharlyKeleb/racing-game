/** Numeric race awareness. +X is the driver's left, +Z is forward; no render/physics imports. */
export interface AwarenessCar {
  id:number; x:number; y:number; z:number; fx:number; fz:number; vx:number; vz:number
  halfWidth:number; halfLength:number; route:number
}
export type SpotterCue='left'|'right'|'both'|'clear-left'|'clear-right'|'clear'
export interface RadarContact {id:number;active:boolean;left:number;forward:number;angle:number;width:number;length:number;closing:number;overlap:boolean;approaching:boolean}
export const RADAR_RANGE=32
export const RADAR_WIDTH=9
export const MAX_CONTACTS=16

/** All buffers are created once; update reuses cells and emits at most one cue per interval. */
export class ProximityRadar {
  readonly contacts:RadarContact[]=Array.from({length:MAX_CONTACTS},()=>({id:0,active:false,left:0,forward:0,angle:0,width:0,length:0,closing:0,overlap:false,approaching:false}))
  left=false
  right=false
  rear=false
  notice:SpotterCue|null=null
  cue:SpotterCue|null=null
  private leftEnter=0
  private rightEnter=0
  private leftExit=0
  private rightExit=0
  private cooldown=0
  private warmup=.6
  private noticeTime=0
  private announcedLeft=false
  private announcedRight=false
  reset():void {
    for(const c of this.contacts)c.active=false
    this.left=this.right=this.rear=this.announcedLeft=this.announcedRight=false
    this.leftEnter=this.rightEnter=this.leftExit=this.rightExit=this.cooldown=this.noticeTime=0
    this.warmup=.6;this.notice=this.cue=null
  }
  /** `connected` rejects a static wall between cars. Route metres reject nearby separate stretches. */
  update(player:AwarenessCar,rivals:readonly AwarenessCar[],lapLength:number,dt:number,connected:(a:AwarenessCar,b:AwarenessCar)=>boolean):void {
    dt=Math.max(0,Math.min(dt,.1));this.cue=null
    this.cooldown=Math.max(0,this.cooldown-dt);this.warmup=Math.max(0,this.warmup-dt)
    this.noticeTime=Math.max(0,this.noticeTime-dt);if(!this.noticeTime)this.notice=null
    let left=false,right=false,slot=0;this.rear=false
    for(const cell of this.contacts)cell.active=false
    for(const rival of rivals){
      if(slot===MAX_CONTACTS)break
      const dx=rival.x-player.x,dz=rival.z-player.z,forward=dx*player.fx+dz*player.fz,lateral=dx*player.fz-dz*player.fx
      if(!Number.isFinite(dx+dz+rival.y+player.y)||Math.abs(rival.y-player.y)>1.6||Math.abs(forward)>RADAR_RANGE||Math.abs(lateral)>RADAR_WIDTH)continue
      const distance=Math.hypot(dx,dz)
      let routeGap=Math.abs(rival.route-player.route)
      if(lapLength>0)routeGap=Math.min(routeGap,Math.max(0,lapLength-routeGap))
      if(routeGap>Math.max(24,distance*1.8+8)||!connected(player,rival))continue
      const dot=rival.fx*player.fx+rival.fz*player.fz,cross=rival.fx*player.fz-rival.fz*player.fx
      const alongExtent=player.halfLength+Math.abs(dot)*rival.halfLength+Math.abs(cross)*rival.halfWidth
      const lateralExtent=player.halfWidth+Math.abs(dot)*rival.halfWidth+Math.abs(cross)*rival.halfLength
      const side=lateral>=0?this.left:this.right
      const overlapping=Math.abs(forward)<alongExtent+(side?1.5:.3)&&Math.abs(lateral)<=lateralExtent+(side?2:1.4)
      const radial=distance>.1?-((rival.vx-player.vx)*dx+(rival.vz-player.vz)*dz)/distance:0
      const approaching=forward< -alongExtent&&radial>2.5&&(-forward-alongExtent)/radial<3&&Math.abs(lateral)<lateralExtent+2
      const c=this.contacts[slot++];c.id=rival.id;c.active=true;c.left=lateral;c.forward=forward;c.angle=Math.atan2(cross,dot)
      c.width=rival.halfWidth*2;c.length=rival.halfLength*2;c.closing=radial;c.overlap=overlapping;c.approaching=approaching
      // A spun car across the player's centre can occupy both flanks.
      if(overlapping){
        if(lateral>.6)left=true
        else if(lateral<-.6)right=true
        else if(Math.abs(cross)>.65){left=true;right=true}
      }
      this.rear ||= approaching
    }
    this.leftEnter=left?this.leftEnter+dt:0;this.rightEnter=right?this.rightEnter+dt:0
    this.leftExit=left?0:this.leftExit+dt;this.rightExit=right?0:this.rightExit+dt
    if(this.leftEnter>=.15)this.left=true;else if(this.leftExit>=.5)this.left=false
    if(this.rightEnter>=.15)this.right=true;else if(this.rightExit>=.5)this.right=false
    if(this.warmup>0||this.cooldown>0)return
    if(this.left!==this.announcedLeft||this.right!==this.announcedRight){
      const cue:SpotterCue=this.left&&this.right?'both':this.left&&!this.announcedLeft?'left':this.right&&!this.announcedRight?'right':!this.left&&!this.right?'clear':!this.left&&this.announcedLeft?'clear-left':'clear-right'
      this.cue=this.notice=cue;this.noticeTime=1.3;this.cooldown=1.4
      this.announcedLeft=this.left;this.announcedRight=this.right
    }
  }
}

/** Accumulated centreline distance with local projection from the existing tracked index. */
export class AwarenessRoute {
  readonly metres:Float64Array
  readonly length:number
  private readonly line:readonly {x:number;y:number;z:number}[]
  constructor(line:readonly {x:number;y:number;z:number}[]){
    this.line=line;this.metres=new Float64Array(line.length+1)
    for(let i=0;i<line.length;i++){const a=line[i],b=line[(i+1)%line.length];this.metres[i+1]=this.metres[i]+Math.hypot(b.x-a.x,b.z-a.z)}
    this.length=this.metres[line.length]
  }
  project(x:number,z:number,index:number):number {
    const n=this.line.length;if(n<2)return 0
    let best=Infinity,route=this.metres[index%n]
    for(let j=-2;j<=1;j++){
      const i=(index+j+n)%n,a=this.line[i],b=this.line[(i+1)%n],dx=b.x-a.x,dz=b.z-a.z,len=dx*dx+dz*dz
      const t=len>0?Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/len)):0
      const d=(x-a.x-t*dx)**2+(z-a.z-t*dz)**2
      if(d<best){best=d;route=this.metres[i]+t*(this.metres[i+1]-this.metres[i])}
    }
    return route
  }
}
