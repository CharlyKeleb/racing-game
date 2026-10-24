export interface IdentityHistoryEntry {
  event_id: string
  player_id: string
  recorded_at: string
  kind: 'baseline' | 'created' | 'renamed'
  old_handle: string | null
  old_display_name: string | null
  new_handle: string
  new_display_name: string
}
export interface IdentityHistoryCursor { at: string; id: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const handle = (v: unknown): v is string => typeof v === 'string' && /^[a-z][a-z0-9_]{2,19}$/.test(v)
const name = (v: unknown): v is string => typeof v === 'string' && [...v].length >= 2 && [...v].length <= 24
  && v === v.normalize('NFC').trim() && !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v)

/** Owner-only display data. Copy known fields; never turn audit rows into profile writes. */
export function parseIdentityHistoryPage(value: unknown, playerId: string): IdentityHistoryEntry[] {
  if (!Array.isArray(value) || value.length > 21) throw new Error('Invalid identity history page')
  const ids = new Set<string>()
  return value.map((row: IdentityHistoryEntry) => {
    if (!row || typeof row.event_id !== 'string' || !uuid.test(row.event_id) || ids.has(row.event_id)
      || row.player_id !== playerId || typeof row.recorded_at !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(row.recorded_at)
      || !Number.isFinite(Date.parse(row.recorded_at)) || !handle(row.new_handle) || !name(row.new_display_name)) throw new Error('Invalid identity history entry')
    if (row.kind === 'renamed') {
      if (!handle(row.old_handle) || !name(row.old_display_name)
        || (row.old_handle === row.new_handle && row.old_display_name === row.new_display_name)) throw new Error('Invalid identity change')
    } else if ((row.kind !== 'created' && row.kind !== 'baseline') || row.old_handle !== null || row.old_display_name !== null) {
      throw new Error('Invalid initial identity')
    }
    ids.add(row.event_id)
    return { event_id: row.event_id, player_id: row.player_id, recorded_at: row.recorded_at, kind: row.kind,
      old_handle: row.old_handle, old_display_name: row.old_display_name, new_handle: row.new_handle, new_display_name: row.new_display_name }
  })
}
