import { createStore } from 'zustand/vanilla'
import { capPayout, carPrice, STARTER_CARS, STARTING_COINS, type RewardLine } from '../racing/Economy'

/** Coins, owned cars and the last race's payout. Saved (and cloud-synced) as racing-game:wallet. */
export interface Wallet {
  coins: number
  owned: string[]
  /** Coins paid on `day` (local date, YYYY-MM-DD), for the daily soft cap. */
  day: string
  earnedToday: number
  /** Best lap ever per track (ms), for the lap-record bonus. */
  bestLaps: Record<string, number>
}

export interface Payout {
  lines: RewardLine[]
  /** Sum of the lines, and what was paid after the daily cap. */
  earned: number
  paid: number
}

interface WalletState extends Wallet {
  /** The last race's payout, for the results screen; null until one is paid. */
  lastPayout: Payout | null
  award(lines: RewardLine[]): Payout
  /** Records a lap; returns the best before it (null: no lap here yet). */
  recordLap(track: string, lapMs: number): number | null
  owns(carId: string): boolean
  /** Spend coins on a car. False when it's owned already or there isn't enough. */
  buy(carId: string): boolean
  /** Re-read from localStorage, after a cloud save was written there. */
  reloadSaved(): void
}

export const WALLET_KEY = 'racing-game:wallet'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A saved wallet, repaired; a new one (starter cars, starting coins, plus `current`) when there's none. */
export function readWallet(raw: string | null, current?: string): Wallet {
  let w: Partial<Wallet> | null = null
  try { w = raw ? JSON.parse(raw) as Partial<Wallet> : null } catch { w = null }
  const owned = new Set([...STARTER_CARS, ...(Array.isArray(w?.owned) ? w.owned.filter((id): id is string => typeof id === 'string') : [])])
  // A player who was already driving a car before cars cost anything keeps it.
  if (!w && current) owned.add(current)
  const bestLaps: Record<string, number> = {}
  if (w?.bestLaps && typeof w.bestLaps === 'object') for (const [k, v] of Object.entries(w.bestLaps)) if (typeof v === 'number' && v > 0) bestLaps[k] = v
  return {
    coins: w && Number.isFinite(w.coins) ? Math.max(0, Math.floor(w.coins!)) : STARTING_COINS,
    owned: [...owned],
    day: typeof w?.day === 'string' ? w.day : today(),
    earnedToday: w && Number.isFinite(w.earnedToday) ? Math.max(0, w.earnedToday!) : 0,
    bestLaps,
  }
}

function load(): Wallet {
  try {
    const settings = JSON.parse(localStorage.getItem('racing-game:settings') ?? 'null') as { car?: unknown } | null
    return readWallet(localStorage.getItem(WALLET_KEY), typeof settings?.car === 'string' ? settings.car : undefined)
  } catch {
    return readWallet(null)
  }
}

function save(w: Wallet): void {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify({ coins: w.coins, owned: w.owned, day: w.day, earnedToday: w.earnedToday, bestLaps: w.bestLaps }))
  } catch {
    // storage unavailable: the wallet lasts the session
  }
}

export const walletStore = createStore<WalletState>()((set, get) => ({
  ...load(),
  lastPayout: null,
  award(lines) {
    const s = get()
    const day = today()
    const earnedToday = s.day === day ? s.earnedToday : 0
    const earned = lines.reduce((sum, l) => sum + l.coins, 0)
    const paid = capPayout(earned, earnedToday)
    const payout = { lines, earned, paid }
    set({ coins: s.coins + paid, day, earnedToday: earnedToday + paid, lastPayout: payout })
    save(get())
    return payout
  },
  recordLap(track, lapMs) {
    const s = get()
    const previous = s.bestLaps[track] ?? null
    if (previous === null || lapMs < previous) {
      set({ bestLaps: { ...s.bestLaps, [track]: lapMs } })
      save(get())
    }
    return previous
  },
  owns(carId) {
    return carPrice(carId) === 0 || get().owned.includes(carId)
  },
  buy(carId) {
    const s = get()
    const price = carPrice(carId)
    if (s.owns(carId) || s.coins < price) return false
    set({ coins: s.coins - price, owned: [...s.owned, carId] })
    save(get())
    return true
  },
  reloadSaved() {
    set(load())
  },
}))
