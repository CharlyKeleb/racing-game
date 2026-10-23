import { RACE_PROTOCOL, LOBBY_CARS, type RaceDescriptor, type RaceResult } from './protocol.js'

export interface ResultRecord {
  schema: 1
  ruleset: 'online-practice-v1' | 'online-practice-v2'
  fingerprint: string
  simulationVersion: number
  protocol: 2 | typeof RACE_PROTOCOL
  result: RaceResult
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const integer = (v: unknown, min: number, max: number): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max

/** Revalidate disk records before replay; neither the API nor a browser supplies this payload. */
export function isResultRecord(value: unknown): value is ResultRecord {
  if (!value || typeof value !== 'object') return false
  const v = value as ResultRecord, r = v.result
  if (v.schema !== 1 || !((v.ruleset === 'online-practice-v1' && v.protocol === 2) || (v.ruleset === 'online-practice-v2' && v.protocol === RACE_PROTOCOL))
    || typeof v.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(v.fingerprint) || !integer(v.simulationVersion, 1, 1_000_000)
    || !r || typeof r.raceId !== 'string' || !UUID.test(r.raceId) || r.track !== 'nurburgring' || r.tickRate !== 60
    || !integer(r.laps, 1, 10) || !integer(r.completedTick, 181, 36_180)
    || !['all-finished', 'finish-window', 'time-limit', ...(v.protocol === 3 ? ['all-resolved'] : [])].includes(r.reason) || !Array.isArray(r.racers) || r.racers.length !== 2) return false
  const elapsed = r.completedTick - 180
  const ids = new Set<string>()
  for (const racer of r.racers) {
    if (!racer || typeof racer.id !== 'string' || !UUID.test(racer.id) || ids.has(racer.id)
      || !(LOBBY_CARS as readonly string[]).includes(racer.carId) || !Array.isArray(racer.lapTicks)
      || racer.lapTicks.length > r.laps || !racer.lapTicks.every((t: unknown) => integer(t, 1, elapsed))) return false
    ids.add(racer.id)
    if (racer.retiredTicks !== undefined || racer.dnfReason !== undefined) {
      if (v.protocol !== 3 || racer.status !== 'dnf' || !integer(racer.retiredTicks, 1, elapsed)
        || !['left', 'connection-lost', 'auth-expired'].includes(racer.dnfReason!)) return false
    }
    const sum = racer.lapTicks.reduce((a: number, b: number) => a + b, 0)
    if (racer.status === 'finished') {
      if (!integer(racer.finishTicks, 1, elapsed) || racer.lapTicks.length !== r.laps || sum !== racer.finishTicks) return false
      const rank = 1 + r.racers.filter(other => other && typeof other.finishTicks === 'number' && other.finishTicks < racer.finishTicks!).length
      if (racer.rank !== rank) return false
    } else if (racer.status !== 'dnf' || racer.finishTicks !== null || racer.rank !== null || racer.lapTicks.length >= r.laps || sum > (racer.retiredTicks ?? elapsed)) return false
  }
  const finishers = r.racers.filter(p => p.status === 'finished')
  if (r.reason === 'all-resolved') {
    const retired = r.racers.filter(p => p.retiredTicks !== undefined)
    const last = Math.max(...r.racers.map(p => p.finishTicks ?? p.retiredTicks ?? Infinity))
    return retired.length > 0 && retired.length + finishers.length === 2 && elapsed === last
  }
  if (r.reason === 'all-finished') return finishers.length === 2 && elapsed === Math.max(...finishers.map(p => p.finishTicks!))
  if (r.reason === 'time-limit') return elapsed === 36_000 && finishers.length < 2
  return finishers.length === 1 && elapsed === finishers[0].finishTicks! + 3600
}

export function resultRecord(descriptor: RaceDescriptor, result: RaceResult): ResultRecord {
  const record: ResultRecord = { schema: 1, ruleset: 'online-practice-v2', fingerprint: descriptor.fingerprint,
    simulationVersion: descriptor.simulationVersion, protocol: descriptor.protocol, result }
  if (descriptor.id !== result.raceId || !isResultRecord(record)) throw new Error('Invalid server result')
  return structuredClone(record)
}
