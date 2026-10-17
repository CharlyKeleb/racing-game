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

export interface NitroConfig {
  /** Seconds a full tank lasts. */
  durationSec: number
  /** Tank fraction gained per second at full slip. */
  fillRate: number
  /** Mean tire slip (0..1) above which the tank starts filling. */
  slipThreshold: number
  /** No filling below this speed, m/s, so launch wheelspin can't farm nitro. */
  minFillSpeed: number
  /** Tank fraction needed to start a boost. */
  minCharge: number
  /** Forward thrust at the center of mass while boosting, N. Bypasses the tires, like a rocket. */
  force: number
  /** Fractional gain in drag-limited top speed while boosting (0.15 = +15%). */
  topSpeedBonus: number
  /** Boost ramp in/out, units/s. */
  rampRate: number
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
  /**
   * Share of drive force sent to the front axle when both axles have driven
   * wheels (AWD), 0..1. Ignored for RWD/FWD cars.
   */
  frontDriveShare: number
  /** Total brake force across all wheels, N. */
  brakeForce: number
  handbrakeForce: number
  /** Max steering angle at standstill, radians. Reduced with speed. */
  maxSteerAngle: number
  /** How fast the wheels turn in, rad/s at standstill; slows with speed like the angle. */
  steerSpeed: number
  /** Return-to-center is this much faster than turning in, so the car settles quickly. */
  steerReturnScale: number
  /** Speed (m/s) at which the steer angle and rate are halved. Lower = calmer at speed. */
  steerFalloffSpeed: number
  /** Pedal ramp, units/s: smooths digital keyboard throttle/brake into a short fade. */
  pedalRate: number
  /**
   * Arcade stability assist, 1/s. Trims yaw beyond what the steering and tire
   * grip can produce, so the car turns where it's pointed instead of wobbling
   * or over-rotating. 0 = off; ~6 feels assisted; handbrake bypasses it.
   */
  yawStability: number
  dragCoefficient: number
  downforceCoefficient: number
  nitro: NitroConfig
  /** Exhaust tips in car-local space, for nitro flames. Derived from the chassis when absent. */
  exhausts?: [number, number, number][]
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
  frontDriveShare: 0.4,
  brakeForce: 22000,
  handbrakeForce: 9000,
  maxSteerAngle: 0.55,
  steerSpeed: 2.6,
  steerReturnScale: 1.8,
  steerFalloffSpeed: 9,
  pedalRate: 6,
  yawStability: 8,
  dragCoefficient: 0.46,
  downforceCoefficient: 1.6,
  nitro: {
    durationSec: 4,
    fillRate: 0.25,
    slipThreshold: 0.55,
    minFillSpeed: 12,
    minCharge: 0.15,
    force: 6500,
    topSpeedBonus: 0.15,
    rampRate: 5,
  },
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
    nitro: { ...d.nitro, ...partial.nitro },
    wheels: partial.wheels ?? d.wheels,
  }
}
