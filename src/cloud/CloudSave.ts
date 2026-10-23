import { validateRacer, profileError } from './racerIdentity'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { accountStore, type Player } from '../stores/accountStore'
import { gameStore, type GamePhase } from '../stores/gameStore'
import { mergeSnapshots, parseSnapshot, readSnapshot, replaceSnapshot, sameSnapshot, writeSnapshot, type SaveSnapshot } from './saveData'

/**
 * Player accounts and cloud save, on Supabase (docs/ACCOUNTS.md).
 *
 * localStorage stays the source the game reads; this mirrors it to one
 * `player_saves` row per player. Signing in merges the cloud save into this
 * device, then every later change uploads a couple of seconds after it lands.
 * Without the Supabase env vars it does nothing and the game stays local-only.
 */

const TABLE = 'player_saves'
const UPLOAD_DELAY_MS = 2000
/** Which player this device last synced, so a different account replaces the progress rather than merging into it. */
const LAST_PLAYER_KEY = 'racing-game:account:last-player'

function supabaseConfig(): { url: string; key: string } | null {
  const env = import.meta.env
  const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  return typeof url === 'string' && url && typeof key === 'string' && key ? { url, key } : null
}

/** Cloud saves only apply between races: a new car or track mid-race would swap under the player. */
const isIdle = (phase: GamePhase) => phase === 'menu' || phase === 'garage'

const message = (err: unknown) => (err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String(err.message) : String(err))

export class CloudSave {
  private readonly client: Promise<SupabaseClient | null>
  private playerId: string | null = null
  /** False until this player's cloud save has merged in; uploads wait for it. */
  private merged = false
  private pendingMerge = false
  private lastUploaded: SaveSnapshot | null = null
  private uploadTimer: ReturnType<typeof setTimeout> | null = null
  private readonly cleanup: (() => void)[] = []
  private disposed = false

  constructor() {
    const config = supabaseConfig()
    if (!config) {
      this.client = Promise.resolve(null)
      return
    }
    accountStore.setState({ status: 'loading' })
    readReturnError()
    void loadProviders(config)
    // Lazy: keeps supabase-js out of the boot path.
    this.client = import('@supabase/supabase-js')
      .then(({ createClient }) => {
        if (this.disposed) return null
        const client = createClient(config.url, config.key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
        // Supabase asks that the callback doesn't await its own calls, hence the timeout.
        const { data } = client.auth.onAuthStateChange((_event, session) => setTimeout(() => this.onSession(session), 0))
        this.cleanup.push(() => data.subscription.unsubscribe())
        return client
      })
      .catch((err: unknown) => {
        console.warn('Cloud save unavailable', err)
        accountStore.setState({ status: 'unavailable', error: message(err) })
        return null
      })
    this.cleanup.push(
      gameStore.subscribe((s, prev) => {
        if (s.settings !== prev.settings || s.builds !== prev.builds || s.presets !== prev.presets) this.scheduleUpload()
        if (s.phase !== prev.phase && this.pendingMerge && isIdle(s.phase)) void this.pullAndMerge()
        if (isIdle(prev.phase) && !isIdle(s.phase) && accountStore.getState().returnError) accountStore.setState({ returnError: false })
      }),
      accountStore.subscribe((s, prev) => {
        if (s.localSaves !== prev.localSaves) this.scheduleUpload()
      }),
    )
    window.addEventListener('pagehide', this.onPageHide)
    this.cleanup.push(() => window.removeEventListener('pagehide', this.onPageHide))
  }

  async signInWithGoogle(): Promise<void> {
    const client = await this.client
    if (!client) return
    accountStore.setState({ error: null })
    const { error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } })
    if (error) accountStore.setState({ error: message(error) })
  }

  async sendSignInLink(email: string): Promise<void> {
    const client = await this.client
    if (!client) return
    accountStore.setState({ error: null, linkSentTo: null })
    const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: returnUrl() } })
    accountStore.setState(error ? { error: message(error) } : { linkSentTo: email.trim() })
  }

  /** Uploads anything pending first. This device keeps its progress for guest play. */
  async signOut(): Promise<void> {
    const client = await this.client
    if (!client) return
    await this.uploadNow()
    const { error } = await client.auth.signOut()
    if (error) accountStore.setState({ error: message(error) })
  }

  async multiplayerToken(): Promise<string | null> {
    const client = await this.client
    if (!client || !this.playerId) return null
    const { data, error } = await client.auth.getSession()
    if (error || data.session?.user.id !== this.playerId) return null
    return data.session.access_token
  }

  async loadProfile(): Promise<void> {
    const client = await this.client
    const playerId = this.playerId
    if (!client || !playerId) return
    accountStore.setState({ profileStatus: 'loading', profileError: null })
    try {
      const { data, error } = await client.from('profiles').select('id, handle, display_name, handle_changed_at').eq('id', playerId).maybeSingle()
      if (this.disposed || this.playerId !== playerId) return
      if (error) throw error
      accountStore.setState({ profile: data, profileStatus: 'ready' })
    } catch {
      if (!this.disposed && this.playerId === playerId) accountStore.setState({ profileStatus: 'error', profileError: 'Could not load your racer. Please retry.' })
    }
  }

  async saveRacerProfile(handle: string, displayName: string): Promise<void> {
    const client = await this.client
    const playerId = this.playerId
    if (!client || !playerId) return
    const validation = validateRacer(handle, displayName)
    if (validation) { accountStore.setState({ profileError: validation }); return }
    accountStore.setState({ profileError: null })
    try {
      const { data, error } = await client.rpc('save_racer_profile', { requested_handle: handle.trim(), requested_display_name: displayName.normalize('NFC').trim() })
      if (this.disposed || this.playerId !== playerId) return
      if (error) { accountStore.setState({ profileError: profileError(error) }); return }
      accountStore.setState({ profile: data, profileStatus: 'ready' })
    } catch {
      if (!this.disposed && this.playerId === playerId) accountStore.setState({ profileError: 'Could not save your racer. Please try again.' })
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.uploadTimer) clearTimeout(this.uploadTimer)
    for (const off of this.cleanup) off()
  }

  private onSession(session: Session | null): void {
    if (this.disposed) return
    const user = session?.user
    if (!user) {
      this.playerId = null
      this.merged = this.pendingMerge = false
      this.lastUploaded = null
      if (this.uploadTimer) clearTimeout(this.uploadTimer)
      accountStore.setState({ status: 'signedOut', player: null, profile: null, profileStatus: 'idle', profileError: null, sync: 'idle', lastSyncedAt: null })
      return
    }
    const meta = user.user_metadata ?? {}
    const player: Player = {
      id: user.id,
      email: user.email ?? null,
      name: typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null,
      avatarUrl: typeof meta.avatar_url === 'string' ? meta.avatar_url : null,
    }
    accountStore.setState({ status: 'signedIn', player, linkSentTo: null, error: null })
    // Token refreshes re-send the session: only a new player needs the merge.
    if (user.id === this.playerId) return
    this.playerId = user.id
    accountStore.setState({ profile: null, profileStatus: 'loading', profileError: null })
    void this.loadProfile()
    this.merged = false
    void this.pullAndMerge()
  }

  private async pullAndMerge(): Promise<void> {
    const client = await this.client
    const playerId = this.playerId
    if (!client || !playerId) return
    if (!isIdle(gameStore.getState().phase)) {
      this.pendingMerge = true
      return
    }
    this.pendingMerge = false
    accountStore.setState({ sync: 'syncing' })
    const { data, error } = await client.from(TABLE).select('data').eq('user_id', playerId).maybeSingle()
    if (playerId !== this.playerId) return
    if (error) {
      accountStore.setState({ sync: 'error', error: message(error) })
      return
    }
    const cloud = parseSnapshot(data?.data)
    const local = readSnapshot(localStorage)
    const otherPlayer = readLastPlayer()
    const next = cloud && otherPlayer && otherPlayer !== playerId ? cloud : mergeSnapshots(local, cloud)
    try {
      if (!sameSnapshot(next, local)) {
        if (next === cloud) replaceSnapshot(localStorage, next)
        else writeSnapshot(localStorage, next)
        gameStore.getState().reloadSaved()
      }
      localStorage.setItem(LAST_PLAYER_KEY, playerId)
    } catch {
      // Storage full or blocked: the cloud save still holds the progress.
    }
    this.merged = true
    if (cloud && sameSnapshot(next, cloud)) {
      this.lastUploaded = cloud
      accountStore.setState({ sync: 'synced', lastSyncedAt: Date.now() })
    } else await this.upload(next)
  }

  private scheduleUpload(): void {
    if (!this.playerId || !this.merged) return
    if (this.uploadTimer) clearTimeout(this.uploadTimer)
    this.uploadTimer = setTimeout(() => void this.uploadNow(), UPLOAD_DELAY_MS)
  }

  private async uploadNow(): Promise<void> {
    if (this.uploadTimer) clearTimeout(this.uploadTimer)
    this.uploadTimer = null
    if (!this.playerId || !this.merged) return
    const snapshot = readSnapshot(localStorage)
    if (this.lastUploaded && sameSnapshot(snapshot, this.lastUploaded)) return
    await this.upload(snapshot)
  }

  private async upload(snapshot: SaveSnapshot): Promise<void> {
    const client = await this.client
    const playerId = this.playerId
    if (!client || !playerId) return
    accountStore.setState({ sync: 'syncing' })
    const { error } = await client.from(TABLE).upsert({ user_id: playerId, data: snapshot, updated_at: new Date().toISOString() })
    if (playerId !== this.playerId) return
    if (error) accountStore.setState({ sync: 'error', error: message(error) })
    else {
      this.lastUploaded = snapshot
      accountStore.setState({ sync: 'synced', lastSyncedAt: Date.now(), error: null })
    }
  }

  private readonly onPageHide = () => {
    if (this.uploadTimer) void this.uploadNow()
  }
}

/**
 * A failed email or Google sign-in comes back as ?error_description=… (and the
 * same in the hash). Show it in the account dialog and tidy the address bar.
 */
function readReturnError(): void {
  const params = new URLSearchParams(location.search)
  const hash = new URLSearchParams(location.hash.slice(1))
  const description = params.get('error_description') ?? hash.get('error_description')
  if (!description) return
  const expired = (params.get('error_code') ?? hash.get('error_code')) === 'otp_expired'
  accountStore.setState({ error: expired ? 'That sign-in link has expired or was already used. Send a new one and open only the latest email.' : description, returnError: true })
  history.replaceState(history.state, '', location.pathname)
}

/** Public auth settings: which providers the project has turned on. */
async function loadProviders(config: { url: string; key: string }): Promise<void> {
  try {
    const res = await fetch(`${config.url}/auth/v1/settings`, { headers: { apikey: config.key } })
    const external = ((await res.json()) as { external?: Record<string, unknown> }).external ?? {}
    accountStore.setState({ providers: { google: external.google === true, email: external.email !== false } })
  } catch {
    // Offline: keep the defaults (email only).
  }
}

function readLastPlayer(): string | null {
  try {
    return localStorage.getItem(LAST_PLAYER_KEY)
  } catch {
    return null
  }
}

/** OAuth and email links come back to the page the player signed in from. */
function returnUrl(): string {
  return `${location.origin}${location.pathname}`
}
