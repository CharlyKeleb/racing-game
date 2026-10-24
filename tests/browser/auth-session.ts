// Development-only real-session fixture. Credentials remain inside the Supabase client.
import { createClient } from '@supabase/supabase-js'
if (!import.meta.env.DEV || !['127.0.0.1', 'localhost'].includes(location.hostname)) throw new Error('Local development only')
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (new URL(url).origin !== 'https://uqxxdjxiqczgigyifldl.supabase.co') throw new Error('Unexpected project')
const client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false } })
const status = document.querySelector<HTMLElement>('#status')!
const output = document.querySelector<HTMLElement>('#report')!
const check = document.querySelector<HTMLButtonElement>('#check')!
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!
let running = false
async function verify(rotate = false) {
  if (running) return
  running = true; check.disabled = refresh.disabled = true
  status.textContent = 'Checking…'; output.textContent = ''
  try {
    const before = await client.auth.getSession()
    if (before.error || !before.data.session) { status.textContent = 'Signed out. Sign in to the game in this browser first.'; return }
    if (rotate) {
      const changed = await client.auth.refreshSession()
      if (changed.error || !changed.data.session) throw new Error('refresh')
    }
    const current = await client.auth.getSession()
    const session = current.data.session
    if (current.error || !session || !session.expires_at || session.expires_at * 1000 <= Date.now()) throw new Error('session')
    const verified = await client.auth.getUser()
    if (verified.error || verified.data.user?.id !== session.user.id) throw new Error('auth')
    const profile = await client.from('profiles').select('id,handle,display_name').eq('id', verified.data.user.id).single()
    if (profile.error || profile.data.id !== verified.data.user.id) throw new Error('profile')
    const history = await client.rpc('my_online_practice_history')
    const names = await client.rpc('my_racer_identity_history')
    if (history.error || names.error || !Array.isArray(history.data) || !Array.isArray(names.data)
      || [...history.data, ...names.data].some((row: { player_id: string }) => row.player_id !== verified.data.user.id)) throw new Error('history')
    if (rotate && (session.expires_at < (before.data.session.expires_at ?? 0))) throw new Error('refresh expiry')
    const latest = history.data[0]
    let latestRace
    if (latest) {
      if (typeof latest.race_id !== 'string' || latest.leaderboard_eligible !== false) throw new Error('practice record')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(latest.race_id))
      latestRace = { raceDigest: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
        status: latest.status, reason: latest.reason, protocol: latest.race_protocol, ruleset: latest.ruleset,
        leaderboardEligible: latest.leaderboard_eligible, retiredTicks: latest.retired_ticks, dnfReason: latest.dnf_reason }
    }
    output.textContent = JSON.stringify({ racer: profile.data.handle, authServerAccepted: true, profileOwnerMatches: true,
      raceHistoryRows: history.data.length, identityHistoryRows: names.data.length, allReturnedRowsOwned: true, ...(latestRace ? { latestRace } : {}),
      sessionExpiresAt: new Date(session.expires_at * 1000).toISOString(),
      refreshPerformed: rotate, ...(rotate ? { expiryDidNotRegress: true, accessTokenRotated: session.access_token !== before.data.session.access_token } : {}) }, null, 2)
    status.textContent = 'Passed'
  } catch { status.textContent = 'Check failed. No credentials or provider details are shown. Return to the game and check your session.' }
  finally { running = false; check.disabled = refresh.disabled = false }
}
check.onclick = () => { void verify() }
refresh.onclick = () => { void verify(true) }
void verify()
