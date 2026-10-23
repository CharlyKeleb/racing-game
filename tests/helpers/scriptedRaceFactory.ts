import type { RaceFactory } from '../../server/src/RaceSession'
import type { RaceVehicleState } from '../../server/src/protocol'
import { gates, route } from './raceCourse'

/** Test-only authoritative route. Exercises transport/results without a human completing a lap.
 * Not a physics or Nürburgring-completion acceptance test. Never imported by shipped entrypoints.
 */
export function scriptedRaceFactory(onDispose = () => {}): RaceFactory {
  return { fingerprint: 'a'.repeat(64), checkpoints: gates, simulationVersion: 1, create: async seats => {
    let tick = 0, disposed = false
    const position = (id: string, out: { x: number; y: number; z: number }) => {
      const elapsed = tick - 180 - (id === seats[1].id ? 15 : 0)
      const index = Math.floor((elapsed - 1) / 3)
      const p = index < 0 ? [0, 1] : route[index % route.length]
      out.x = p[0]; out.y = .6; out.z = p[1]
    }
    return {
      step: () => { tick++ }, position, setInput: () => {},
      states: () => seats.map(r => {
        const state: RaceVehicleState = { id: r.id, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, velocity: { x: 0, y: 0, z: 0 }, angularVelocity: { x: 0, y: 0, z: 0 }, speed: 0, steer: 0, rpm: 900, gear: 1, nitro: 0 }
        position(r.id, state.position)
        return state
      }),
      dispose: () => { if (!disposed) { disposed = true; onDispose() } },
    }
  } }
}
