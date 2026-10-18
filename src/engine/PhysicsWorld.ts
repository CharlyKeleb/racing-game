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

  step(dt: number): void {
    this.world.timestep = dt
    this.world.step()
  }

  dispose(): void {
    this.world.free()
  }
}
