import { createClient } from '@supabase/supabase-js'
import { decodeJwt } from 'jose'

export interface VerifiedRacer { id: string; handle: string; displayName: string; expiresAt: number }
export type Authenticate = (token: string) => Promise<VerifiedRacer>
export class AdmissionError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

/** getUser asks this project's Auth server to verify the signature/session, including legacy HS256. */
export function supabaseAuthenticator(url: string, publishableKey: string): Authenticate {
  const issuer = `${url.replace(/\/$/, '')}/auth/v1`
  return async (token) => {
    if (!token || token.length > 8192) throw new AdmissionError(401, 'Sign in again to join a lobby.')
    const client = createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
    })
    const { data, error } = await client.auth.getUser(token)
    if (error || !data.user) throw new AdmissionError(401, 'Sign in again to join a lobby.')
    // Decode only AFTER server verification. Never trust editable user_metadata for identity.
    const claims = decodeJwt(token)
    if (claims.iss !== issuer || claims.sub !== data.user.id || claims.aud !== 'authenticated'
      || typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
      throw new AdmissionError(401, 'Your session has expired. Sign in again.')
    }
    const { data: profile, error: profileError } = await client.from('profiles').select('id,handle,display_name').eq('id', data.user.id).maybeSingle()
    if (profileError) throw new AdmissionError(503, 'Racer profiles are temporarily unavailable.')
    if (!profile) throw new AdmissionError(403, 'Create your racer profile before joining online.')
    return { id: data.user.id, handle: profile.handle, displayName: profile.display_name, expiresAt: claims.exp * 1000 }
  }
}
