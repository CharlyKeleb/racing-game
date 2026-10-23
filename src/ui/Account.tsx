import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FcGoogle } from 'react-icons/fc'
import { GiCloudUpload } from 'react-icons/gi'
import { useGameInstance } from './GameContext'
import { useAccount } from './hooks'
import { Button, Panel } from './kit'

/** Menu corner button: "Sign in", or the signed-in player's initial and sync state. Hidden in local-only builds. */
export function AccountButton({ onOpen }: { onOpen(): void }) {
  const status = useAccount((s) => s.status)
  const player = useAccount((s) => s.player)
  const sync = useAccount((s) => s.sync)
  if (status === 'unavailable') return null
  const label = player ? player.name ?? player.email ?? 'Player' : 'Sign in'
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
  const { status, player, sync, lastSyncedAt, error, linkSentTo } = useAccount((s) => s)
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
        <span className="eyebrow">Cloud save</span>
        <h2 id="account-title" className="ui-panel__title">{player ? 'Your account' : 'Sign in'}</h2>
        {status === 'signedIn' && player ? <>
          <p className="account-dialog__who">Signed in as <strong>{player.email ?? player.name}</strong></p>
          <p className="race-setup__note" role="status">{syncLabel(sync, lastSyncedAt)}</p>
          <p className="race-setup__note">Settings, garage builds, presets, Time Trial bests and drift records follow you to any device. Graphics settings stay per device.</p>
          <Button variant="secondary" disabled={busy} onClick={() => run(() => game?.signOut())}>Sign out</Button>
        </> : <>
          <p className="race-setup__note">Save your settings, garage builds, presets and best laps, and pick them up on any device. You can keep playing without an account.</p>
          <Button variant="secondary" className="account-dialog__google" disabled={busy || !game} onClick={() => run(() => game?.signInWithGoogle())}>
            <FcGoogle aria-hidden /> Continue with Google
          </Button>
          <form className="account-dialog__email" onSubmit={sendLink}>
            <label className="ui-field">
              <span className="ui-field__label">Or get a sign-in link by email</span>
              <input className="ui-input" type="email" required autoComplete="email" placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <Button variant="primary" type="submit" disabled={busy || !game}>Email me a link</Button>
          </form>
          {linkSentTo && <p className="account-dialog__sent" role="status">Check {linkSentTo} and open the link on this device.</p>}
        </>}
        {error && <p className="account-dialog__error" role="alert">{error}</p>}
        <Button variant="ghost" onClick={() => dialog.current?.close()}>Close</Button>
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
