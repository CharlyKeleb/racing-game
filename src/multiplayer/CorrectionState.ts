import { isInputApplication, RACE_PROTOCOL, MAX_CORRECTION_BYTES, type CorrectionEnvelope, type LobbyCar } from '../../server/src/protocol'
import type { VehicleControllerState } from '../vehicles/VehicleController'
import type { VehicleConfig } from '../vehicles/VehicleConfig'

export { MAX_CORRECTION_BYTES } from '../../server/src/protocol'
const MAX_TICK = 180 + 60 * 600
/** Fully validated owner-only server correction. */
export interface CorrectionState extends Omit<CorrectionEnvelope, 'controller'> {
  controller: VehicleControllerState
}
/** Supplied by the already verified race/assets and previous accepted correction, never by payload fields. */
export interface CorrectionBinding {
  raceId: string
  racerId: string
  carId: LobbyCar
  fingerprint: string
  simulationVersion: number
  afterTick: number
  acknowledgedSequence: number
  maximumSentSequence: number
  config: VehicleConfig
}
type Reader<T> = (value: unknown) => T
type Schema<T> = { [K in keyof T]-?: Reader<T[K]> }
function invalid(): never { throw new Error('Invalid correction state') }
function object<T extends object>(value: unknown, schema: Schema<T>): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const record = value as Record<string, unknown>, keys = Object.keys(schema)
  if (Object.keys(record).length !== keys.length || keys.some(key => !Object.hasOwn(record, key))) return invalid()
  const result: Record<string, unknown> = {}
  for (const key of keys) result[key] = schema[key as keyof T](record[key])
  return result as T
}
const number = (min: number, max: number, integer = false): Reader<number> => value => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || typeof value !== 'number' || !Number.isFinite(value)
    || value < min || value > max || (integer && !Number.isSafeInteger(value))) return invalid()
  return value
}
const boolean: Reader<boolean> = value => typeof value === 'boolean' ? value : invalid()
const member = <T extends string | number>(...allowed: T[]): Reader<T> => value => allowed.includes(value as T) ? value as T : invalid()
const equal = <T extends string | number>(expected: T): Reader<T> => value => value === expected ? expected : invalid()
const timer = number(0, 3600)
const idleTimer: Reader<number | null> = value => value === null ? null : timer(value)
const unit = number(0, 1)
function vector(limit: number): Reader<{ x: number; y: number; z: number }> {
  const component = number(-limit, limit)
  return value => object(value, { x: component, y: component, z: component })
}

function controllerReader(config: VehicleConfig): Reader<VehicleControllerState> {
  const gear = number(-1, config.engine.gearRatios.length - 1, true)
  const suspension: Reader<VehicleControllerState['wheels'][number]['suspension']> = value => object(value, {
    compression: number(0, config.suspension.travel), prevCompression: number(0, config.suspension.travel),
    velocity: number(-10000, 10000), peak: number(0, 10000),
  })
  const wheel: Reader<VehicleControllerState['wheels'][number]> = value => object(value, {
    suspension, grounded: boolean, contactPoint: vector(1_000_000), spin: number(-1e8, 1e8),
    slip: unit, slide: number(0, 10000), surface: member(0, 1, 2, 3, 4, 5),
  })
  const wheels: Reader<VehicleControllerState['wheels']> = value => {
    if (!Array.isArray(value) || value.length !== 4) return invalid()
    return value.map(wheel)
  }
  return value => object(value, {
    version: equal(1), driftMode: boolean, drafting: unit, launchPush: number(-1000, 1000),
    steerAngle: number(-Math.PI, Math.PI), wheelAngle: number(-Math.PI, Math.PI),
    gripTurnRate: number(-1000, 1000), driftThrottle: unit, forwardSpeed: number(-1000, 1000), braking: unit, throttle: unit, brake: unit,
    drivetrain: value => object(value, { gear, manual: boolean, rpm: number(0, config.engine.redlineRpm), shiftTimer: number(-.1, 3600) }),
    nitro: value => object(value, { charge: unit, active: boolean, perfect: boolean, missed: boolean, missedAt: timer,
      intensity: number(0, Math.max(1, config.nitro.perfectBoost)), ignited: boolean, surge: unit, burnTime: timer,
      perfectLeft: number(-.1, 3600), attempted: boolean, releasedFor: timer, wasHeld: boolean }),
    drift: value => object(value, { amount: unit, active: boolean, exiting: boolean, entry: member(-1, 0, 1), direction: member(-1, 0, 1),
      score: number(0, 1e12), lastScore: number(0, 1e12, true), sinceEnd: idleTimer, brakeHeld: timer, steeredWhileBraking: boolean,
      tapArm: timer, counter: timer, brakeArm: timer, downshiftArm: timer, wasBraking: boolean, calm: timer, exitTimer: timer }),
    burnout: value => object(value, { intensity: unit, holding: boolean }),
    backfire: value => object(value, { popped: member(0, 1, 2), strength: unit, flash: unit, flashKind: member(0, 1, 2),
      count: number(0, 1e6, true), sinceHigh: idleTimer, burst: number(0, 5, true), nextBurst: number(-.1, 3600),
      sincePop: idleTimer, lastGear: gear, burnoutNext: number(-.1, 3600), seed: number(0, 0xffff_ffff, true) }),
    wheels,
  })
}

/** Decode all or nothing. Never normalizes/clamps state, calls restore, or advances acceptance cursors. */
export function decodeCorrectionJson(text: string, binding: CorrectionBinding): CorrectionState | null {
  try {
    if (typeof text !== 'string' || text.length > MAX_CORRECTION_BYTES || new TextEncoder().encode(text).byteLength > MAX_CORRECTION_BYTES
      || !/^[a-f0-9]{64}$/.test(binding.fingerprint) || !binding.raceId || binding.raceId.length > 128
      || !binding.racerId || binding.racerId.length > 128 || binding.config.wheels.length !== 4
      || !Number.isSafeInteger(binding.afterTick) || binding.afterTick < -1 || binding.afterTick >= MAX_TICK
      || !Number.isSafeInteger(binding.acknowledgedSequence) || binding.acknowledgedSequence < -1
      || !Number.isSafeInteger(binding.maximumSentSequence) || binding.maximumSentSequence < binding.acknowledgedSequence
      || !Number.isSafeInteger(binding.simulationVersion) || binding.simulationVersion < 1) return null
    const result = object<CorrectionState>(JSON.parse(text), {
      version: equal(1), raceProtocol: equal(RACE_PROTOCOL), raceId: equal(binding.raceId), racerId: equal(binding.racerId),
      carId: equal(binding.carId), fingerprint: equal(binding.fingerprint), simulationVersion: equal(binding.simulationVersion),
      tick: number(Math.max(1, binding.afterTick + 1), MAX_TICK, true),
      acknowledgedSequence: number(binding.acknowledgedSequence, binding.maximumSentSequence, true),
      inputApplication: value => object(value, { mode: member('hold', 'neutral', 'command'),
        firstTick: value => value === null ? null : number(1, MAX_TICK, true)(value),
        lastTick: value => value === null ? null : number(1, MAX_TICK, true)(value) }),
      body: value => object(value, { position: vector(1_000_000), velocity: vector(1000), angularVelocity: vector(1000), sleeping: boolean,
        rotation: value => object(value, { x: number(-1, 1), y: number(-1, 1), z: number(-1, 1), w: number(-1, 1) }) }),
      controller: controllerReader(binding.config),
    })
    const q = result.body.rotation, norm = Math.hypot(q.x, q.y, q.z, q.w)
    if (Math.abs(norm - 1) > .001 || !isInputApplication(result.inputApplication, result.acknowledgedSequence, result.tick)) return null
    return result
  } catch { return null }
}
