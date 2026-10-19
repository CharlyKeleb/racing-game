import { Surface } from '../vehicles/Surface'
import type { Vehicle } from '../vehicles/Vehicle'
import { createParticles, particleBudget, type ParticleSpawn } from './Particles'

const MAX_MIST = 900
const MAX_DROPLETS = 1200
/** Below this speed (m/s) a tyre doesn't throw water. */
const MIN_SPEED = 4
/** Mist puffs / droplets per second per rear wheel at REF_SPEED; scales with speed^1.5. */
const MIST_RATE = 34
const DROPLET_RATE = 60
const REF_SPEED = 40
/** Fronts throw much less than rears (the rears run through the fronts' spray). */
const FRONT_SCALE = 0.35
/** Rivals further than this from the camera don't spray (m). */
const MAX_DISTANCE = 140

/**
 * How much water one tyre throws, 0.. (#53): nothing slow, rising with
 * speed^1.5 (more water lifted, and atomised finer, the faster the tread
 * spins). 1 at 40 m/s (~145 km/h).
 */
export function sprayAmount(speed: number): number {
  if (speed <= MIN_SPEED) return 0
  return Math.pow((speed - MIN_SPEED) / (REF_SPEED - MIN_SPEED), 1.5)
}

const _p: ParticleSpawn = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, startSize: 1, endSize: 1, alpha: 1, r: 1, g: 1, b: 1, lift: 0, drag: 0 }

/**
 * Spray off wet tyres (#53), for every car: a fine mist that hangs in a
 * rooster tail behind the car and blinds whoever follows (the reason real
 * drivers pull out of the slipstream in the wet), plus heavier droplets
 * flung up and back off the tread. Only on paved surfaces: loose ground
 * already throws its own spray.
 */
export class RainSpray {
  private readonly mist = createParticles(MAX_MIST, 'puff', 3, [1.2, 4.5])
  private readonly droplets = createParticles(MAX_DROPLETS, 'grain', 2, [0.6, 1.5])
  private readonly budget = particleBudget()
  /** GPU particles: many more, fainter mist puffs; denser droplets. */
  private readonly mistRate = MIST_RATE * this.budget
  private readonly mistAlpha = Math.pow(this.budget, -0.55)
  private readonly dropletRate = DROPLET_RATE * Math.sqrt(this.budget)
  /** Fractional spawns owed, per car × wheel. */
  private readonly debt = new Float32Array(64)

  get meshes() {
    return [this.mist.mesh, this.droplets.mesh]
  }

  /** `wet` 0..1 (0 when dry). `cars[0]` is the player. Render-time. */
  update(cars: readonly Vehicle[], camera: { x: number; z: number }, wet: number, dt: number): void {
    if (wet > 0) {
      for (let c = 0; c < cars.length && c < 8; c++) {
        const car = cars[c]
        const v = car.body.linvel()
        const speed = Math.hypot(v.x, v.z)
        const amount = sprayAmount(speed) * wet
        const pos = car.body.translation()
        if (amount <= 0 || (c > 0 && Math.hypot(pos.x - camera.x, pos.z - camera.z) > MAX_DISTANCE)) continue
        const wheels = car.controller.wheels
        for (let i = 0; i < wheels.length && i < 8; i++) {
          const w = wheels[i]
          if (!w.grounded || (w.surface !== Surface.Asphalt && w.surface !== Surface.Kerb)) continue
          const axle = w.cfg.position[2] < 0 ? 1 : FRONT_SCALE
          const slot = c * 8 + i
          let debt = this.debt[slot] + (this.mistRate + this.dropletRate) * amount * axle * dt
          const mistShare = this.mistRate / (this.mistRate + this.dropletRate)
          while (debt >= 1) {
            debt -= 1
            if (Math.random() < mistShare) this.spawnMist(w.contactPoint, v, speed, amount)
            else this.spawnDroplet(w.contactPoint, v, speed)
          }
          this.debt[slot] = debt
        }
      }
    }
    this.mist.update(dt, 0.4, 0.2)
    this.droplets.update(dt)
  }

  private spawnMist(at: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, speed: number, amount: number): void {
    // Lifted off the road behind the tyre and dragged along in the car's wake.
    const back = speed > 0.1 ? 1 / speed : 0
    _p.x = at.x - v.x * back * 0.4 + (Math.random() - 0.5) * 0.4
    _p.y = at.y + 0.15 + Math.random() * 0.2
    _p.z = at.z - v.z * back * 0.4 + (Math.random() - 0.5) * 0.4
    _p.vx = v.x * (0.45 + Math.random() * 0.2) + (Math.random() - 0.5) * 1.5
    _p.vy = 0.6 + Math.random() * 1.4
    _p.vz = v.z * (0.45 + Math.random() * 0.2) + (Math.random() - 0.5) * 1.5
    _p.life = 1.2 + Math.random() * 1.3
    _p.startSize = 0.5 + Math.random() * 0.4
    _p.endSize = 2.6 + Math.random() * 2 * Math.min(1.5, amount)
    _p.alpha = (0.07 + 0.08 * Math.min(1, amount)) * this.mistAlpha
    const shade = 0.82 + Math.random() * 0.06
    _p.r = shade
    _p.g = shade + 0.02
    _p.b = shade + 0.05
    _p.lift = 0.25
    _p.drag = 1.4
    _p.bounce = 0
    this.mist.spawn(_p)
  }

  private spawnDroplet(at: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, speed: number): void {
    _p.x = at.x + (Math.random() - 0.5) * 0.3
    _p.y = at.y + 0.05
    _p.z = at.z + (Math.random() - 0.5) * 0.3
    // Flung off the top of the tread: up and back relative to the car.
    const fling = 0.15 + Math.random() * 0.25
    _p.vx = v.x * (1 - fling) + (Math.random() - 0.5) * 2
    _p.vy = 1.5 + Math.random() * (2 + speed * 0.05)
    _p.vz = v.z * (1 - fling) + (Math.random() - 0.5) * 2
    _p.life = 0.5 + Math.random() * 0.4
    _p.startSize = _p.endSize = 0.008 + Math.random() * 0.012
    _p.alpha = 0.3
    _p.r = 0.85
    _p.g = 0.9
    _p.b = 0.96
    _p.lift = -9.81
    _p.drag = 0.6
    _p.bounce = 0
    this.droplets.spawn(_p, at.y)
  }

  clear(): void {
    this.mist.clear()
    this.droplets.clear()
    this.debt.fill(0)
  }

  dispose(): void {
    for (const m of this.meshes) m.removeFromParent()
    this.mist.dispose()
    this.droplets.dispose()
  }
}
