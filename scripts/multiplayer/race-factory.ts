import { HeadlessSimulation, SIMULATION_VERSION, type SimulationTrack } from '../../src/simulation/HeadlessSimulation'
import { startingGrid } from '../../src/racing/StartingGrid'
import { resolveVehicleConfig, type VehicleConfig } from '../../src/vehicles/VehicleConfig'
import type { RaceFactory, ServerRaceSimulation } from '../../server/src/RaceSession'
import { CORRECTION_VERSION, LOBBY_CARS, RESET_VERSION, type RaceVehicleState } from '../../server/src/protocol'

export interface SimulationBundle {
  format: number
  fingerprint: string
  track: SimulationTrack
  cars: Record<string, Partial<VehicleConfig>>
}

/** Local development adapter. One active world until production memory/capacity is established. */
export function createRaceFactory(bundle: SimulationBundle, options: { scheduledInputs?: boolean } = {}): RaceFactory {
  if (bundle.format !== 1 || !/^[a-f0-9]{64}$/.test(bundle.fingerprint) || bundle.track.id !== 'nurburgring') throw new Error('Invalid simulation asset package')
  const configs = new Map(LOBBY_CARS.map(id => {
    if (!bundle.cars[id]) throw new Error(`Missing stock config: ${id}`)
    return [id, resolveVehicleConfig(bundle.cars[id])] as const
  }))
  let active = false
  // Ready before the first race is created (see HeadlessSimulation.prepare).
  const prepared = HeadlessSimulation.prepare(bundle.track)
  prepared.catch(() => {}) // create() awaits it and reports the failure there
  return {
    correctionVersion: CORRECTION_VERSION,
    resetVersion: RESET_VERSION,
    ...(options.scheduledInputs ? { scheduledInputVersion: 1 as const } : {}),
    checkpoints: bundle.track.checkpoints,
    fingerprint: bundle.fingerprint,
    simulationVersion: SIMULATION_VERSION,
    async create(seats) {
      if (active || seats.length !== 2) throw new Error('Only one two-racer development simulation is allowed')
      active = true
      let simulation: HeadlessSimulation | undefined
      try {
        await prepared
        simulation = await HeadlessSimulation.create(bundle.track)
        const grid = startingGrid(bundle.track.line, bundle.track.spawn.position, seats.length)
        for (let i = 0; i < seats.length; i++) {
          const slot = grid[i]
          const y = simulation.physics.floorHeight(slot.x, slot.y + .6, slot.z)
          const config = configs.get(seats[i].carId)
          if (y === null || !config) throw new Error('Invalid grid or stock car')
          simulation.addRacer(seats[i].id, config, { position: { x: slot.x, y: y + .6, z: slot.z }, heading: slot.heading })
        }
        const world = simulation
        let disposed = false
        const adapter: ServerRaceSimulation = {
          step: () => world.step(),
          position: (id, out) => {
            const p = world.vehicles.get(id)!.body.translation()
            out.x = p.x; out.y = p.y; out.z = p.z
          },
          setInput: (id, input) => world.setInput(id, input),
          respawn: (id, spawn) => {
            if (disposed) throw new Error('Respawn after dispose')
            const y = world.physics.floorHeight(spawn.x, spawn.y + .6, spawn.z)
            world.respawn(id, { position: { x: spawn.x, y: (y ?? spawn.y) + .6, z: spawn.z }, heading: spawn.heading })
          },
          correction: id => {
            const vehicle = world.vehicles.get(id)
            if (!vehicle || disposed) throw new Error('Unknown active correction seat')
            const p = vehicle.body.translation(), q = vehicle.body.rotation(), v = vehicle.body.linvel(), a = vehicle.body.angvel()
            return { body: { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
              velocity: { x: v.x, y: v.y, z: v.z }, angularVelocity: { x: a.x, y: a.y, z: a.z }, sleeping: vehicle.body.isSleeping() },
              controller: vehicle.controller.captureState() }
          },
          states: () => {
            const states: RaceVehicleState[] = []
            for (const [id, vehicle] of world.vehicles) {
              const controller = vehicle.controller
              const p = vehicle.body.translation(), q = vehicle.body.rotation(), v = vehicle.body.linvel(), av = vehicle.body.angvel()
              states.push({ id, position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w },
                velocity: { x: v.x, y: v.y, z: v.z }, angularVelocity: { x: av.x, y: av.y, z: av.z },
                speed: controller.forwardSpeed, steer: controller.wheelAngle, rpm: controller.drivetrain.rpm, gear: controller.drivetrain.gear, nitro: controller.nitro.charge, nitroIntensity: controller.nitro.intensity, braking: controller.braking,
                wheelOffsets: controller.wheels.map(w => w.suspension.wheelOffset()) })
            }
            return states
          },
          dispose: () => { if (!disposed) { disposed = true; world.dispose(); active = false } },
        }
        return adapter
      } catch (error) { simulation?.dispose(); active = false; throw error }
    },
  }
}
