import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PracticeHistoryPanel } from './PracticeHistoryPanel'
import { accountStore } from '../stores/accountStore'
import { validateRacer } from '../cloud/racerIdentity'
import { FcGoogle } from 'react-icons/fc'
import { GiCloudUpload } from 'react-icons/gi'
import { useGameInstance } from './GameContext'
import { useAccount } from './hooks'
import { Button, Panel } from './kit'

/** Menu corner button: "Sign in", or the signed-in player's initial and sync state. Hidden in local-only builds. */
export function AccountButton({ onOpen }: { onOpen(): void }) {
  const status = useAccount((s) => s.status)
  const player = useAccount((s) => s.player)
  const profile = useAccount((s) => s.profile)
  const sync = useAccount((s) => s.sync)
  if (status === 'unavailable') return null
  const label = player ? profile ? profile.display_name : 'Create your racer' : 'Sign in'
  return (
    <button className={`account-chip account-chip--${sync}`} onClick={onOpen} disabled={status === 'loading'}
      aria-label={player ? `Account: ${label}` : 'Sign in to save your progress'}>
      {player
        ? player.avatarUrl
          ? <img src={player.avatarUrl} alt="" referrerPolicy="no-referrer" />
          : <span className="account-chip__initial" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
        : <GiCloudUpload aria-hidden />}
      <span className="account-chip__label">{status === 'loading' ? 'Account…' : label}</span>
    </button>
  )
}

/** Native modal supplies focus trapping, Escape and focus restoration. */
export function AccountDialog({ onClose }: { onClose(): void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const game = useGameInstance()
  const { status, player, sync, lastSyncedAt, error, linkSentTo, providers } = useAccount((s) => s)
  const { profile, profileStatus, profileError } = useAccount((s) => s)
  const [tab, setTab] = useState<'racer' | 'history'>('racer')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { dialog.current?.showModal() }, [])

  const run = (action: () => Promise<void> | undefined) => {
    setBusy(true)
    void Promise.resolve(action()).finally(() => setBusy(false))
  }
  const sendLink = (e: FormEvent) => {
    e.preventDefault()
    if (email.includes('@')) run(() => game?.sendSignInLink(email))
  }

  return (
    <dialog ref={dialog} className="race-setup account-dialog" aria-labelledby="account-title" onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) dialog.current?.close() }}>
      <Panel>
        <header className="account-dialog__header">
          <div><span className="eyebrow">Racing / Game</span>
            <h2 id="account-title" className="ui-panel__title">{player ? profile ? 'Your racer' : 'Create your racer' : 'Sign in'}</h2>
          </div>
          <button className="racer-close" type="button" aria-label="Close account" onClick={() => dialog.current?.close()}>×</button>
        </header>
        {status === 'signedIn' && player ? <>
          {profile && <div className="account-tabs" role="group" aria-label="Racer profile">
            <button aria-pressed={tab === 'racer'} onClick={() => setTab('racer')}>Your racer</button>
            <button aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Race history</button>
          </div>}
          {tab === 'history' && profile ? <PracticeHistoryPanel /> : <RacerForm key={`${player.id}:${profile?.handle ?? 'new'}`} onSaved={() => dialog.current?.close()} />}
          {profileStatus === 'loading' && <p role="status">Loading your racer…</p>}
          {profileStatus === 'error' && <><p className="account-dialog__error" role="alert">{profileError}</p><Button variant="secondary" onClick={() => run(() => game?.loadRacerProfile())}>Retry racer profile</Button></>}
          <details className="account-details">
            <summary>Account &amp; cloud save <span aria-hidden="true">＋</span></summary>
            <p className="account-dialog__who">Signed in as <strong>{player.email ?? player.name}</strong></p>
            <p className="race-setup__note" role="status">{syncLabel(sync, lastSyncedAt)}</p>
            <p className="race-setup__note">Your garage, settings and records sync across devices. Graphics settings stay on this device.</p>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => game?.signOut())}>Sign out</Button>
          </details>
        </> : <>
          <p className="race-setup__note">Save your settings, garage builds, presets and best laps, and pick them up on any device. You can keep playing without an account.</p>
          {providers.google && <Button variant="secondary" className="account-dialog__google" disabled={busy || !game} onClick={() => run(() => game?.signInWithGoogle())}>
            <FcGoogle aria-hidden /> Continue with Google
          </Button>}
          {providers.email && <form className="account-dialog__email" onSubmit={sendLink}>
            <label className="ui-field">
              <span className="ui-field__label">{providers.google ? 'Or get a sign-in link by email' : 'Get a sign-in link by email'}</span>
              <input className="ui-input" type="email" required autoComplete="email" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <Button variant="primary" type="submit" disabled={busy || !game}>Email me a link</Button>
          </form>}
          {linkSentTo && <p className="account-dialog__sent" role="status">Check {linkSentTo} and open the link on this device.</p>}
        </>}
        {error && <p className="account-dialog__error" role="alert">{error}</p>}

      </Panel>
    </dialog>
  )
}

function syncLabel(sync: string, at: number | null): string {
  if (sync === 'syncing') return 'Saving to the cloud…'
  if (sync === 'error') return 'Cloud save failed. Your progress is still saved on this device.'
  if (sync === 'synced' && at) return `Saved to the cloud at ${new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  return 'Cloud save ready.'
}

const RACER_SUGGESTIONS = ['apex_runner', 'nightshift_7', 'velvet_redline', 'late_braker', 'neon_circuit', 'midnight_shift', 'curb_runner', 'slipstream_9', 'sunset_driver']

/** The server claims the handle on save; suggestions are not availability promises. */
function RacerForm({ onSaved }: { onSaved(): void }) {
  const game = useGameInstance()
  const { profile, profileStatus, profileError } = useAccount((s) => s)
  const [handle, setHandle] = useState(profile?.handle ?? '')
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '')
  const [busy, setBusy] = useState(false)
  const [suggestionPage, setSuggestionPage] = useState(0)
  const [touched, setTouched] = useState({ handle: false, name: false })
  if (profileStatus !== 'ready') return null
  const canonical = handle.trim().toLowerCase()
  const normalizedName = displayName.normalize('NFC').trim()
  const handleError = validateRacer(handle, 'Racer')
  const nameError = validateRacer('valid_racer', displayName)
  const showHandleError = !!handleError && (touched.handle || handle.length > 0)
  const showNameError = !!nameError && (touched.name || displayName.length > 0)
  const changed = canonical !== profile?.handle || normalizedName !== profile?.display_name
  const edit = () => { if (profileError) accountStore.setState({ profileError: null }) }
  return <form className="racer-form" onSubmit={(e) => {
    e.preventDefault()
    if (handleError || nameError || busy || !game) return
    setBusy(true)
    const playerId = accountStore.getState().player?.id
    void game.saveRacerProfile(handle, displayName).then(() => {
      const state = accountStore.getState()
      if (!state.profileError && state.profile && state.profile.id === playerId
        && state.profile.handle === canonical && state.profile.display_name === normalizedName) onSaved()
    }).finally(() => setBusy(false))
  }}>
    <p className="racer-intro">{profile ? 'Fine-tune the name behind the wheel.' : 'Pick your name. Make it yours.'}</p>
    <div className="racer-card" aria-label="Racer card preview">
      <div className="racer-card__avatar" aria-hidden="true">{[...(normalizedName || 'R')][0].toUpperCase()}</div>
      <div className="racer-card__identity">
        <span className="eyebrow">Your racer card</span>
        <strong>{normalizedName || 'Your display name'}</strong>
        <span className="racer-card__handle">@{canonical || 'your_username'}</span>
      </div>
      <span className="racer-card__flag" aria-hidden="true" />
    </div>
    <div className="racer-field">
      <label htmlFor="racer-display-name">Display name <span>{[...normalizedName].length}/24</span></label>
      <input id="racer-display-name" className="ui-input" required autoComplete="nickname" disabled={busy}
        placeholder="What should we call you?" value={displayName} aria-invalid={showNameError}
        onBlur={() => setTouched((s) => ({ ...s, name: true }))}
        onChange={(e) => { setDisplayName(e.target.value); edit() }} aria-describedby="racer-name-help" />
      <p id="racer-name-help" className={showNameError ? 'racer-hint racer-hint--error' : 'racer-hint'}>
        {showNameError ? nameError : 'Your visible name. 2–24 characters, any language.'}
      </p>
    </div>
    <div className="racer-field">
      <label htmlFor="racer-username">Username <span>Unique handle</span></label>
      <div className={`racer-handle-input ${showHandleError ? 'racer-handle-input--error' : ''}`}>
        <span aria-hidden="true">@</span>
        <input id="racer-username" className="ui-input" required autoComplete="username" autoCapitalize="none" spellCheck={false}
          aria-describedby="racer-handle-help" aria-invalid={showHandleError} disabled={busy} maxLength={20}
          placeholder="your_username" value={handle} onBlur={() => setTouched((s) => ({ ...s, handle: true }))}
          onChange={(e) => { setHandle(e.target.value.toLowerCase()); edit() }} />
      </div>
      <p id="racer-handle-help" className={showHandleError ? 'racer-hint racer-hint--error' : 'racer-hint'}>
        {showHandleError ? handleError : '3–20 letters, numbers or underscores. Start with a letter.'}
      </p>
    </div>
    <div className="racer-suggestions">
      <div className="racer-suggestions__header"><span>Need inspiration?</span>
        <button type="button" disabled={busy} onClick={() => setSuggestionPage((s) => (s + 1) % 3)}>More ideas ↻</button>
      </div>
      <div className="racer-suggestions__options">
        {RACER_SUGGESTIONS.slice(suggestionPage * 3, suggestionPage * 3 + 3).map((name) =>
          <button type="button" key={name} disabled={busy} aria-pressed={canonical === name} onClick={() => { setHandle(name); edit() }}>@{name}</button>)}
      </div>
      <span className="racer-hint">Availability is confirmed when you save.</span>
    </div>
    {profileError && <p className="racer-error" role="alert">{profileError}</p>}
    <div className="racer-form__actions">
      <Button variant="primary" type="submit" disabled={busy || !game || !!handleError || !!nameError || !changed}>
        {busy ? 'Saving your racer…' : profile ? 'Save racer' : 'Create racer'} <span aria-hidden="true">↗</span>
      </Button>
      <p className="racer-hint">{profile && !changed ? 'You’re all set. Edit either name to make a change.' : 'You can change both names anytime.'}</p>
    </div>
  </form>
}
