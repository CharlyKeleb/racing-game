import { DRIFT_EVENT, type DriftEvent } from './driftEvents'
export const LINK_WINDOW = 2.5
export interface DriftSample {
  speed: number
  angle: number
  direction: number
  distance: number
  grounded: boolean
  paved: boolean
  active: boolean
  zone: boolean
  impact: boolean
}
/** Fixed-tick scoring. Speed, angle and distance must all agree: no stationary donuts. */
export class DriftChallenge {
  event:DriftEvent = DRIFT_EVENT
  total = 0
  chain = 0
  multiplier = 1
  bestChain = 0
  longestDrift = 0
  transitions = 0
  zoneSeconds = 0
  peakMultiplier = 1
  banks = 0
  busts = 0
  angle = 0
  speed = 0
  zone = false
  scoring = false
  message = 'BUILD SPEED / TAP BRAKE + TURN'
  messageTime = 0
  private sliding = 0
  private gap = 0
  private direction = 0
  private directionTime = 0
  private driftTime = 0
  private offroadTime = 0
  private impactCooldown = 0
  private travel = 0

  get linkRemaining(): number { return this.chain > 0 ? Math.max(0,1-this.gap/LINK_WINDOW) : 0 }
  get comboProgress(): number { return this.multiplier >= 5 ? 1 : (this.sliding % 2.5) / 2.5 }

  sample(dt:number,s:DriftSample):void {
    this.messageTime=Math.max(0,this.messageTime-dt)
    this.impactCooldown=Math.max(0,this.impactCooldown-dt)
    this.angle=s.angle; this.speed=s.speed; this.zone=s.zone
    this.scoring=false
    if (s.impact) {
      if (this.chain>0 || this.impactCooldown===0) this.bust('WALL HIT / CHAIN LOST')
      this.impactCooldown=1.2
      return
    }
    this.offroadTime=s.paved ? 0 : this.offroadTime+dt
    if (this.chain>0 && (this.offroadTime>.65 || s.angle>100)) {
      this.bust(s.angle>100 ? 'SPUN OUT / CHAIN LOST' : 'OFF TRACK / CHAIN LOST'); return
    }
    const valid=s.active && s.grounded && s.paved && s.speed>=this.event.minSpeed
      && s.angle>=12 && s.angle<=85 && s.distance>0.015
    if (valid) {
      this.scoring=true
      this.driftTime+=dt
      this.longestDrift=Math.max(this.longestDrift,this.driftTime)
      this.travel+=s.distance
      if (s.direction!==0) {
        if (this.direction!==0 && this.direction!==s.direction && this.directionTime>=.4 && this.travel>=8) {
          this.transitions++
          this.chain+=250*this.multiplier
          this.cue('CLEAN TRANSITION +250')
          this.directionTime=0; this.travel=0
        }
        this.direction=s.direction
        this.directionTime+=dt
      }
      if (s.zone) this.zoneSeconds+=dt
      const quality=Math.min(1.6,Math.max(.4,s.angle/35))
      const rate=Math.min(s.speed,180)*quality*(s.zone ? 1.75 : 1)
      this.update(dt,rate*dt,true)
    } else {
      this.driftTime=0
      this.update(dt,0,false)
    }
  }

  update(dt: number, points: number, valid: boolean): void {
    if (valid && points > 0) {
      this.gap = 0
      this.sliding += dt
      this.multiplier = Math.min(5, 1 + Math.floor(this.sliding / 2.5))
      this.peakMultiplier=Math.max(this.peakMultiplier,this.multiplier)
      this.chain += points * this.multiplier
    } else if (this.chain > 0) {
      this.gap += dt
      if (this.gap >= LINK_WINDOW) this.bank()
    }
  }

  cue(message:string):void { this.message=message; this.messageTime=2 }
  bank(): void {
    const points=Math.round(this.chain)
    if (points>0) {
      this.total+=points; this.bestChain=Math.max(this.bestChain,points); this.banks++
      this.cue(`BANKED +${points.toLocaleString()}`)
    }
    this.discard()
  }
  bust(message='RESET / CHAIN LOST'):void {
    if (this.chain>0) { this.busts++; this.cue(message) }
    this.discard()
  }
  discard(): void {
    this.chain = this.sliding = this.gap = this.direction = this.directionTime = this.travel = this.driftTime = 0
    this.multiplier = 1
  }
  reset(event:DriftEvent=DRIFT_EVENT): void {
    this.event=event
    this.total=this.bestChain=this.longestDrift=this.transitions=this.zoneSeconds=this.banks=this.busts=0
    this.angle=this.speed=this.offroadTime=this.impactCooldown=this.messageTime=0
    this.peakMultiplier=1;this.zone=this.scoring=false
    this.message='BUILD SPEED / TAP BRAKE + TURN'
    this.discard()
  }
}
