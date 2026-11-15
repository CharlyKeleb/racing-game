/**
 * Cloud save format: the player's progress is the localStorage values
 * the game already writes, copied key for key. Pure apart from the Storage
 * passed in, so the merge rules are unit tested.
 *
 * Synced: settings, per-car builds, build presets, the wallet (coins and owned
 * cars), Time Trial bests and drift records. Device settings (quality, renderer, post FX, motion blur) stay on
 * the device: a phone shouldn't pick up a desktop's High preset.
 */

export const SAVE_VERSION = 1

export interface SaveSnapshot {
  version: typeof SAVE_VERSION
  /** Raw localStorage values by key. */
  entries: Record<string, string>
}

const PREFIX = 'racing-game:'
const SETTINGS_KEY = `${PREFIX}settings`
const WALLET_KEY = `${PREFIX}wallet`
const CAREER_KEY = `${PREFIX}career`
const WHOLE_KEYS = new Set([SETTINGS_KEY, `${PREFIX}builds`, `${PREFIX}presets`, WALLET_KEY, CAREER_KEY])
const TRIAL_PREFIX = `${PREFIX}trial:`
const DRIFT_PREFIX = `${PREFIX}drift:`
export const DEVICE_SETTINGS = ['quality', 'renderer', 'postfx', 'motionBlur'] as const

export function isSyncedKey(key: string): boolean {
  return WHOLE_KEYS.has(key) || key.startsWith(TRIAL_PREFIX) || key.startsWith(DRIFT_PREFIX)
}

/** Every synced key in `storage`, device settings removed. */
export function readSnapshot(storage: Storage): SaveSnapshot {
  const entries: Record<string, string> = {}
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (!key || !isSyncedKey(key)) continue
    const value = storage.getItem(key)
    if (value === null) continue
    entries[key] = key === SETTINGS_KEY ? withoutDeviceSettings(value) : value
  }
  return { version: SAVE_VERSION, entries }
}

/** Writes a snapshot back, keeping this device's own device settings. */
export function writeSnapshot(storage: Storage, snapshot: SaveSnapshot): void {
  for (const [key, value] of Object.entries(snapshot.entries)) {
    if (!isSyncedKey(key)) continue
    storage.setItem(key, key === SETTINGS_KEY ? withDeviceSettings(value, storage.getItem(key)) : value)
  }
}

/** Like writeSnapshot, but synced keys the snapshot lacks are removed: a different player's progress doesn't carry over. */
export function replaceSnapshot(storage: Storage, snapshot: SaveSnapshot): void {
  const stale: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)
    if (key && isSyncedKey(key) && !(key in snapshot.entries)) stale.push(key)
  }
  for (const key of stale) storage.removeItem(key)
  writeSnapshot(storage, snapshot)
}

/** A cloud row's `data`, or null when it isn't a save this version understands. */
export function parseSnapshot(raw: unknown): SaveSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const { version, entries } = raw as Partial<SaveSnapshot>
  if (version !== SAVE_VERSION || !entries || typeof entries !== 'object') return null
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(entries)) if (isSyncedKey(key) && typeof value === 'string') out[key] = value
  return { version: SAVE_VERSION, entries: out }
}

/**
 * Signing in on a device that already has progress. The cloud wins for
 * settings; builds and presets combine per car (cloud first); records keep
 * the better of the two (fastest lap, highest drift score).
 */
export function mergeSnapshots(local: SaveSnapshot, cloud: SaveSnapshot | null): SaveSnapshot {
  if (!cloud) return local
  const entries: Record<string, string> = { ...local.entries }
  for (const [key, value] of Object.entries(cloud.entries)) {
    const mine = local.entries[key]
    entries[key] = mine === undefined ? value : mergeEntry(key, mine, value)
  }
  return { version: SAVE_VERSION, entries }
}

export function sameSnapshot(a: SaveSnapshot, b: SaveSnapshot): boolean {
  const ka = Object.keys(a.entries), kb = Object.keys(b.entries)
  return ka.length === kb.length && ka.every((k) => a.entries[k] === b.entries[k])
}

function mergeEntry(key: string, local: string, cloud: string): string {
  if (key.startsWith(TRIAL_PREFIX)) return lapMs(local) < lapMs(cloud) ? local : cloud
  if (key.startsWith(DRIFT_PREFIX)) return driftScore(local) > driftScore(cloud) ? local : cloud
  if (key === `${PREFIX}builds`) return mergeObjects(local, cloud, (_mine, theirs) => theirs)
  if (key === `${PREFIX}presets`) return mergeObjects(local, cloud, mergePresetLists)
  if (key === WALLET_KEY) return mergeWallets(local, cloud)
  if (key === CAREER_KEY) return mergeCareers(local, cloud)
  return cloud
}

/** Career: an event won on either device stays won. */
function mergeCareers(local: string, cloud: string): string {
  const won = (v: string) => { const p = parse(v) as { won?: unknown } | null; return Array.isArray(p?.won) ? p.won.filter((id): id is string => typeof id === 'string') : [] }
  return JSON.stringify({ won: [...new Set([...won(local), ...won(cloud)])] })
}

function parse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function lapMs(value: string): number {
  const ms = (parse(value) as { lapMs?: unknown } | null)?.lapMs
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? ms : Infinity
}

function driftScore(value: string): number {
  const score = (parse(value) as { score?: unknown } | null)?.score
  return typeof score === 'number' && Number.isFinite(score) ? score : 0
}

/** Per car id, `pick` resolves cars both sides have. Unreadable JSON loses to readable. */
function mergeObjects(local: string, cloud: string, pick: (mine: unknown, theirs: unknown) => unknown): string {
  const mine = parse(local), theirs = parse(cloud)
  if (!isRecord(theirs)) return local
  if (!isRecord(mine)) return cloud
  const out: Record<string, unknown> = { ...mine }
  for (const [car, value] of Object.entries(theirs)) out[car] = car in mine ? pick(mine[car], value) : value
  return JSON.stringify(out)
}

/** Cloud presets first, then local ones it doesn't have (by id). The store trims to the slot limit. */
function mergePresetLists(mine: unknown, theirs: unknown): unknown {
  if (!Array.isArray(theirs)) return mine
  if (!Array.isArray(mine)) return theirs
  const ids = new Set(theirs.map((p: { id?: unknown }) => p?.id))
  return [...theirs, ...mine.filter((p: { id?: unknown }) => !ids.has(p?.id))]
}

/**
 * The cloud's coins (taking the larger would hand back coins spent on another device), every car
 * either side owns, and the better lap per track.
 */
function mergeWallets(local: string, cloud: string): string {
  const mine = parse(local), theirs = parse(cloud)
  if (!isRecord(theirs)) return local
  if (!isRecord(mine)) return cloud
  const owned = [...new Set([...(Array.isArray(theirs.owned) ? theirs.owned : []), ...(Array.isArray(mine.owned) ? mine.owned : [])])]
  const bestLaps: Record<string, unknown> = { ...(isRecord(mine.bestLaps) ? mine.bestLaps : {}) }
  if (isRecord(theirs.bestLaps)) for (const [track, ms] of Object.entries(theirs.bestLaps)) {
    const other = bestLaps[track]
    if (typeof ms === 'number' && (typeof other !== 'number' || ms < other)) bestLaps[track] = ms
  }
  return JSON.stringify({ ...theirs, owned, bestLaps })
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function withoutDeviceSettings(value: string): string {
  const settings = parse(value)
  if (!isRecord(settings)) return value
  for (const k of DEVICE_SETTINGS) delete settings[k]
  return JSON.stringify(settings)
}

function withDeviceSettings(value: string, current: string | null): string {
  const settings = parse(value)
  const device = current === null ? null : parse(current)
  if (!isRecord(settings) || !isRecord(device)) return value
  for (const k of DEVICE_SETTINGS) if (k in device) settings[k] = device[k]
  else delete settings[k]
  return JSON.stringify(settings)
}
