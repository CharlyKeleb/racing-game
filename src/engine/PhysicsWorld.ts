import RAPIER from '@dimforge/rapier3d-compat'

export type Rapier = typeof RAPIER

const _down = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

let initPromise: Promise<void> | null = null

/** Rapier ships as WASM; initialise once per page. */
export function initRapier(): Promise<void> {
  initPromise ??= RAPIER.init()
  return initPromise
}

/**
 * Thin owner of the Rapier world. Gameplay code talks to Rapier directly for
 * bodies/colliders; this class only owns lifecycle and stepping.
 */
export class PhysicsWorld {
  readonly rapier: Rapier = RAPIER
  readonly world: RAPIER.World
  /** Contact force events (car bodies hitting things), drained after each step. */
  private readonly events = new RAPIER.EventQueue(true)

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  }

  /**
   * Height of the static ground under (x, z), searching from a little above
   * `nearY` downward; null if nothing's there. Ignores cars. Colliders are only
   * queryable after the first step that follows their creation. `only` limits
   * the hit to some colliders (e.g. road surfaces, not the coarse terrain).
   */
  groundHeight(x: number, nearY: number, z: number, only?: (collider: RAPIER.Collider) => boolean): number | null {
    const top = nearY + 4
    _down.origin = { x, y: top, z }
    const hit = this.world.castRay(_down, 12, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC, undefined, undefined, undefined, only)
    return hit ? top - hit.timeOfImpact : null
  }

  /**
   * Like groundHeight, but a surface more than `headroom` m above nearY is a
   * roof over the street (a station canopy, a deck), not floor: look on below
   * it, up to three roofs deep. A roof with nothing under it is no floor at all.
   */
  floorHeight(x: number, nearY: number, z: number, headroom = 1.5): number | null {
    let h = this.groundHeight(x, nearY, z)
    for (let i = 0; i < 3 && h !== null && h > nearY + headroom; i++) h = this.groundHeight(x, h - 4.05, z)
    return h !== null && h > nearY + headroom ? null : h
  }

  step(dt: number): void {
    this.world.timestep = dt
    this.world.step(this.events)
  }

  /**
   * Every contact force event since the last step: the two colliders' handles,
   * the total force (N) and its direction. Only colliders with
   * CONTACT_FORCE_EVENTS (car bodies, see Vehicle) report.
   */
  drainContactForces(fn: (a: number, b: number, force: number, dirX: number, dirY: number, dirZ: number) => void): void {
    this.events.drainContactForceEvents((e) => {
      const d = e.maxForceDirection()
      fn(e.collider1(), e.collider2(), e.totalForceMagnitude(), d.x, d.y, d.z)
    })
    this.events.drainCollisionEvents(() => {})
  }

  dispose(): void {
    this.events.free()
    this.world.free()
  }
}
