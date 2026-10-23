/** Public racer identity is stored in profiles, never inferred from email/provider metadata. */
export interface RacerProfile {
  id: string
  handle: string
  display_name: string
  handle_changed_at: string
}

export const RESERVED_HANDLES = ['admin', 'administrator', 'moderator', 'mod', 'staff', 'support', 'system', 'official', 'racing_game', 'supabase']

export function validateRacer(handle: string, displayName: string): string | null {
  const canonical = handle.trim().toLowerCase()
  if (!/^[a-z][a-z0-9_]{2,19}$/.test(canonical)) return 'Use 3–20 letters, numbers or underscores, starting with a letter.'
  if (RESERVED_HANDLES.includes(canonical)) return 'That username is reserved. Choose another.'
  const name = displayName.normalize('NFC').trim()
  if ([...name].length < 2 || [...name].length > 24) return 'Display name must be 2–24 characters.'
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) return 'Display name cannot contain control or hidden formatting characters.'
  return null
}

export function profileError(error: { code?: string; message: string }): string {
  if (error.code === '23505') return 'That username is taken. Try adding a number or another word.'
  if (error.message.includes('reserved_handle')) return 'That username is reserved. Choose another.'
  return 'Could not save your racer. Please try again.'
}
