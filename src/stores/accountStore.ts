import { createStore } from 'zustand/vanilla'

/**
 * Player account and cloud save state, written by cloud/CloudSave.ts.
 * React reads it; sign-in and sign-out go through Game commands.
 */

export interface Player {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
}

export interface AccountState {
  /** 'unavailable': no Supabase env vars in this build, the game stays local-only. */
  status: 'unavailable' | 'loading' | 'signedOut' | 'signedIn'
  player: Player | null
  sync: 'idle' | 'syncing' | 'synced' | 'error'
  lastSyncedAt: number | null
  /** The last sign-in or sync failure, shown in the account dialog. */
  error: string | null
  /** True when a sign-in redirect came back with an error, so the menu opens the account dialog to show it. */
  returnError: boolean
  /** Email a sign-in link was just sent to, so the dialog can say "check your inbox". */
  linkSentTo: string | null
  /** Sign-in methods enabled in the Supabase project; Google stays hidden until it's set up. */
  providers: { google: boolean; email: boolean }
  /** Bumped when progress saves outside gameStore (Time Trial bests, drift records). */
  localSaves: number
}

export const accountStore = createStore<AccountState>()(() => ({
  status: 'unavailable',
  player: null,
  sync: 'idle',
  lastSyncedAt: null,
  error: null,
  returnError: false,
  linkSentTo: null,
  providers: { google: false, email: true },
  localSaves: 0,
}))

/** Call after writing progress to localStorage, so a signed-in player's cloud save picks it up. */
export function noteLocalSave(): void {
  accountStore.setState((s) => ({ localSaves: s.localSaves + 1 }))
}
