import type { DriverPose, TrafficCar } from './AiDriver'

export type PassPhase = 'follow' | 'draft' | 'pass' | 'yield'
/** Committed passing decisions, separate from steering/vehicle physics. */
export class Overtaking {
  phase: PassPhase = 'follow'
  targetId = -1
  lane = 0
  speedLimit = Infinity
  private held = 0
  private cooldown = 0
  private side = 0
  reset(): void { this.phase = 'follow'; this.speedLimit = Infinity; this.targetId = -1; this.lane = this.held = this.cooldown = this.side = 0 }

  update(dt: number, pose: DriverPose, traffic: readonly TrafficCar[], id: number, laneLimit: number, nx: number, nz: number, cx: number, cz: number, charge: number): void {
    const fx = Math.sin(pose.heading), fz = Math.cos(pose.heading)
    this.cooldown = Math.max(0, this.cooldown - dt)
    this.held += dt
    let target: TrafficCar | undefined
    let closest = 40
    for (const car of traffic) {
      if (car.id === id) continue
      const ahead = (car.x - pose.x) * fx + (car.z - pose.z) * fz
      const side = Math.abs((car.x - pose.x) * fz - (car.z - pose.z) * fx)
      if (car.id === this.targetId && ahead > -8 && ahead < 50 && side < 9) target = car
      if (this.targetId < 0 && ahead > 0 && ahead < closest && side < 4 && pose.speed + 2 > car.speed) { closest = ahead; target = car }
    }
    if (!target || this.held > 9) {
      if (this.phase === 'pass') this.cooldown = 0.8
      this.targetId = -1; this.side = 0; this.held = 0; this.phase = 'follow'; this.lane = 0
    } else {
      if (this.targetId !== target.id) {
        this.targetId = target.id; this.held = 0
        const obstacleLane = (target.x - cx) * nx + (target.z - cz) * nz
        this.side = obstacleLane > 0.5 ? -1 : obstacleLane < -0.5 ? 1 : id % 2 ? 1 : -1
        this.phase = this.cooldown > 0 ? 'yield' : target.speed > 12 && closest > 18 && charge < 0.3 ? 'draft' : 'pass'
      }
      const ahead = (target.x - pose.x) * fx + (target.z - pose.z) * fz
      if (this.phase === 'draft' && (this.held > 0.9 || ahead < 17 || charge >= 0.3)) this.phase = 'pass'
      const desired = this.side * Math.min(3.5, laneLimit)
      let safe = laneLimit >= 2.5
      const obstacleLane = (target.x - cx) * nx + (target.z - cz) * nz
      if (Math.abs(desired - obstacleLane) < 2.3) safe = false
      for (const car of traffic) {
        if (car.id === id || car.id === target.id) continue
        const along = (car.x - pose.x) * fx + (car.z - pose.z) * fz
        const carLane = (car.x - cx) * nx + (car.z - cz) * nz
        const closing = car.speed - pose.speed
        if ((along >= 0 || (closing > 3 && -along / closing < 2)) && along > -30 && along < Math.max(18, pose.speed * 0.8) && Math.abs(carLane - desired) < 2.3) safe = false
      }
      if (!safe && this.phase !== 'draft') { this.phase = 'yield'; this.cooldown = 0.8 }
      if (this.phase === 'yield' && safe && this.cooldown === 0) { this.phase = 'pass'; this.held = 0 }
      this.lane = this.phase === 'pass' ? desired : this.phase === 'yield' ? Math.max(-laneLimit, Math.min(laneLimit, (pose.x - cx) * nx + (pose.z - cz) * nz)) : 0
    }
    this.speedLimit = Infinity
    for (const car of traffic) {
      if (car.id === id) continue
      const dx = car.x - pose.x, dz = car.z - pose.z
      const ahead = dx * fx + dz * fz, lateral = Math.abs(dx * fz - dz * fx)
      if (ahead > 0 && ahead < Math.max(10, pose.speed * 1.0) && lateral < 2.2) {
        const crawl = this.phase === 'pass' && lateral > 1.2 && ahead > 4.5 ? 3 : 0
        this.speedLimit = Math.min(this.speedLimit, Math.max(crawl, car.speed + (ahead - 8) * 0.7))
      }
    }
  }
}
