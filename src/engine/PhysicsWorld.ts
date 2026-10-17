import RAPIER from '@dimforge/rapier3d-compat'

export type Rapier = typeof RAPIER

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

  step(dt: number): void {
    this.world.timestep = dt
    this.world.step()
  }

  dispose(): void {
    this.world.free()
  }
}
