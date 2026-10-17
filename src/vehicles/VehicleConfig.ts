/**
 * Data contract between the asset pipeline (Blender MCP → vehicle-config.json)
 * and the runtime vehicle. Every car ships one of these next to its GLB.
 *
 * Conventions (match glTF): meters, kilograms, +Y up, +Z forward, +X left.
 * All positions are in the car's local space, origin at ground level under the
 * geometric center of the chassis.
 */

export type WheelId = 'FL' | 'FR' | 'RL' | 'RR'

export interface WheelConfig {
  id: WheelId
  /** Suspension mount point (top of travel) in car-local space. */
  position: [number, number, number]
  radius: number
  width: number
  steered: boolean
  driven: boolean
  /** Rear wheels get the handbrake. */
  handbrake: boolean
}

export interface SuspensionConfig {
  restLength: number
  /** N/m */
  stiffness: number
  /** N·s/m, compression and rebound. */
  damping: number
  /** Max compression before the bump stop, meters. */
  travel: number
}

export interface TireConfig {
  /** Peak friction coefficient. */
  grip: number
  /** Pacejka-lite shape params for lateral force vs slip angle. */
  corneringStiffness: number
  shape: number
  /** Multiplier on rear lateral grip while the handbrake is held. */
  handbrakeGripScale: number
  rollingResistance: number
  /** Arcade assist: lateral grip takes priority over drive force in the friction circle. */
  tractionControl: boolean
}

export interface EngineConfig {
  idleRpm: number
  redlineRpm: number
  /** [rpm, torqueNm] pairs, ascending rpm. */
  torqueCurve: [number, number][]
  /** Index 0 = reverse (negative), then 1st..nth. */
  gearRatios: number[]
  finalDrive: number
  efficiency: number
  shiftUpRpm: number
  shiftDownRpm: number
  shiftTimeSec: number
}

export interface VehicleConfig {
  id: string
  name: string
  massKg: number
  /** Chassis collision box half-extents [x, y, z]. */
  chassisHalfExtents: [number, number, number]
  /** Center of the chassis collision box in car-local space. */
  chassisCenter: [number, number, number]
  /** Center of mass in car-local space (keep it low for stability). */
  centerOfMass: [number, number, number]
  wheels: WheelConfig[]
  suspension: SuspensionConfig
  tires: TireConfig
  engine: EngineConfig
  /** Total brake force across all wheels, N. */
  brakeForce: number
  handbrakeForce: number
  /** Max steering angle at standstill, radians. Reduced with speed. */
  maxSteerAngle: number
  steerSpeed: number
  dragCoefficient: number
  downforceCoefficient: number
}

/**
 * Hand-tuned defaults roughly modelled on a mid-engine supercar
 * (McLaren 720S-ish: 1.4 t, 4.5 m long, 2.0 m wide, RWD).
 * Replaced at runtime by public/models/cars/<id>/vehicle-config.json when present.
 */
export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  id: 'mclaren',
  name: 'McLaren',
  massKg: 1420,
  chassisHalfExtents: [0.95, 0.3, 2.2],
  chassisCenter: [0, 0.55, 0],
  centerOfMass: [0, 0.38, -0.1],
  wheels: [
    { id: 'FL', position: [0.84, 0.55, 1.35], radius: 0.34, width: 0.25, steered: true, driven: false, handbrake: false },
    { id: 'FR', position: [-0.84, 0.55, 1.35], radius: 0.34, width: 0.25, steered: true, driven: false, handbrake: false },
    { id: 'RL', position: [0.86, 0.55, -1.32], radius: 0.36, width: 0.3, steered: false, driven: true, handbrake: true },
    { id: 'RR', position: [-0.86, 0.55, -1.32], radius: 0.36, width: 0.3, steered: false, driven: true, handbrake: true },
  ],
  suspension: { restLength: 0.32, stiffness: 52000, damping: 4200, travel: 0.2 },
  tires: {
    grip: 1.25,
    corneringStiffness: 9,
    shape: 1.6,
    handbrakeGripScale: 0.5,
    rollingResistance: 0.015,
    tractionControl: true,
  },
  engine: {
    idleRpm: 1000,
    redlineRpm: 8200,
    torqueCurve: [
      [1000, 380],
      [3000, 620],
      [5500, 770],
      [7000, 740],
      [8200, 600],
    ],
    gearRatios: [-3.2, 3.6, 2.4, 1.8, 1.4, 1.12, 0.92, 0.76],
    finalDrive: 3.3,
    efficiency: 0.85,
    shiftUpRpm: 7700,
    shiftDownRpm: 3600,
    shiftTimeSec: 0.12,
  },
  brakeForce: 22000,
  handbrakeForce: 9000,
  maxSteerAngle: 0.55,
  steerSpeed: 4,
  dragCoefficient: 0.38,
  downforceCoefficient: 1.6,
}

/** Shallow-merges a partial JSON config over the defaults, nested objects included. */
export function resolveVehicleConfig(partial: Partial<VehicleConfig> | undefined): VehicleConfig {
  const d = DEFAULT_VEHICLE_CONFIG
  if (!partial) return d
  return {
    ...d,
    ...partial,
    suspension: { ...d.suspension, ...partial.suspension },
    tires: { ...d.tires, ...partial.tires },
    engine: { ...d.engine, ...partial.engine },
    wheels: partial.wheels ?? d.wheels,
  }
}
