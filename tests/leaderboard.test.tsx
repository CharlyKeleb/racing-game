import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Leaderboards } from '../src/cloud/Leaderboards'
import { boardId, buildClass, collectBests, formatGap, parseLeaderboard, sameQuery, unsentBests, type LeaderboardEntry, type LeaderboardQuery, type LeaderboardRow } from '../src/cloud/leaderboardData'
import { accountStore } from '../src/stores/accountStore'
import { leaderboardStore } from '../src/stores/leaderboardStore'
import { gameStore } from '../src/stores/gameStore'
import { Leaderboards as Board } from '../src/ui/Leaderboards'
import { LeaderboardResult } from '../src/ui/LeaderboardResult'
import type { SupabaseClient } from '@supabase/supabase-js'

const row = (over: Partial<LeaderboardRow> = {}): LeaderboardRow => ({ rank: 1, entrants: 2, display_name: 'Racer', car_id: 'porsche911', build_key: 'e0-tstreet-sstock-w0-b0', score: 100_000, set_at: '2026-11-02T10:00:00Z', is_me: false, ...over })
const QUERY: LeaderboardQuery = { mode: 'timeTrial', track: 'nurburgring', event: 'flow', car: null }

describe('local records as scores', () => {
  it('keeps the fastest build per car, and one score per drift event', () => {
    const bests = collectBests({
      'racing-game:trial:nurburgring:bmw:e0-tstreet-sstock-w0-b0:v1': '{"lapMs":120000.4,"splits":[]}',
      'racing-game:trial:nurburgring:bmw:e3-trace-srace-w2-b2:v1': '{"lapMs":100000.6,"splits":[]}',
      'racing-game:trial:canyon:bmw:e0-tstreet-sstock-w0-b0:v1': '{"lapMs":90000}',
      'racing-game:drift:drift-park:flow:course-v1': '{"score":5000.2,"chain":10}',
      'racing-game:drift:drift-park:sprint:course-v1': '{"score":0,"chain":0}',
      'racing-game:trial:nurburgring:amg:e0-tstreet-sstock-w0-b0:v1': 'not json',
      'racing-game:trial:nurburgring:amg:bad-build:v1': '{"lapMs":1000}',
      'racing-game:builds': '{}',
    })
    expect(bests).toEqual([
      { kind: 'trial', track: 'nurburgring', car: 'bmw', build: 'e3-trace-srace-w2-b2', score: 100_001 },
      { kind: 'trial', track: 'canyon', car: 'bmw', build: 'e0-tstreet-sstock-w0-b0', score: 90_000 },
      { kind: 'drift', track: 'drift-park', event: 'flow', score: 5000 },
    ])
  })

  it('sends only what improved', () => {
    const lap: LeaderboardEntry = { kind: 'trial', track: 'city', car: 'bmw', build: 'b', score: 100 }
    const points: LeaderboardEntry = { kind: 'drift', track: 'city', event: 'flow', score: 100 }
    expect(unsentBests([lap, points], new Map())).toEqual([lap, points])
    expect(unsentBests([lap, points], new Map([['trial:city:bmw', 100], ['drift:city:flow', 100]]))).toEqual([])
    expect(unsentBests([lap, points], new Map([['trial:city:bmw', 101], ['drift:city:flow', 99]]))).toEqual([lap, points])
    expect(unsentBests([lap, points], new Map([['trial:city:bmw', 99], ['drift:city:flow', 101]]))).toEqual([])
  })

  it('names boards, and a car filter only separates Time Trial queries', () => {
    expect(boardId(QUERY)).toBe('trial:nurburgring')
    expect(boardId({ ...QUERY, mode: 'drift', track: 'drift-park', event: 'sprint' })).toBe('drift:drift-park:sprint')
    expect(sameQuery(QUERY, { ...QUERY, car: 'bmw' })).toBe(false)
    expect(sameQuery({ ...QUERY, mode: 'drift' }, { ...QUERY, mode: 'drift', car: 'bmw' })).toBe(true)
    expect(sameQuery(QUERY, null)).toBe(false)
  })

  it('reads the class from the build key, null when it can\'t', () => {
    expect(buildClass('koenigsegg', 'e3-trace-srace-w2-b2')).toBe('S')
    expect(buildClass('hovercraft', 'e3-trace-srace-w2-b2')).toBeNull()
    expect(buildClass('', null)).toBeNull()
  })

  it('formats gaps to the leader', () => {
    expect(formatGap('timeTrial', 101_204, 100_000)).toBe('+1.204')
    expect(formatGap('timeTrial', 175_000, 100_000)).toBe('+1:15.000')
    expect(formatGap('drift', 1000, 2250)).toBe(`−${(1250).toLocaleString()}`)
  })
})

describe('server rows', () => {
  it('accepts ascending ranks with a gap for the caller further down', () => {
    expect(parseLeaderboard([row(), row({ rank: 80, entrants: 90, is_me: true })])).toHaveLength(2)
    expect(parseLeaderboard([])).toEqual([])
  })
  it.each([
    ['not a list', {}],
    ['too many', Array.from({ length: 52 }, (_, i) => row({ rank: i + 1, entrants: 99 }))],
    ['out of order', [row({ rank: 2 }), row({ rank: 1 })]],
    ['no name', [row({ display_name: '' })]],
    ['bad score', [row({ score: -1 })]],
    ['bad date', [row({ set_at: 'soon' })]],
  ])('rejects %s', (_name, value) => { expect(() => parseLeaderboard(value)).toThrow() })
})

/** A Supabase client that records RPCs and answers from `answers`, like PostgREST's builder. */
function fakeClient(answers: Record<string, () => { data?: unknown; error?: unknown }>) {
  const calls: { name: string; args: { entries?: LeaderboardEntry[]; board_id?: string; car_filter?: string | null } }[] = []
  const client = { rpc: (name: string, args: never) => {
    calls.push({ name, args })
    return { abortSignal: async () => answers[name]() }
  } } as unknown as SupabaseClient
  return { client, calls }
}
const profile = { id: 'p1', handle: 'racer', display_name: 'Racer', handle_changed_at: '' }
const player = (id: string) => ({ id, email: null, name: null, avatarUrl: null })
const instances: Leaderboards[] = []
function loader(client: SupabaseClient | null, state: { player: string | null; merged: boolean } = { player: 'p1', merged: true }) {
  const l = new Leaderboards(async () => client, () => state.player, () => state.merged)
  instances.push(l)
  return l
}
const memory = (values: Record<string, string>) => {
  const keys = Object.keys(values)
  vi.stubGlobal('localStorage', { length: keys.length, key: (i: number) => keys[i] ?? null, getItem: (k: string) => values[k] ?? null, setItem: (k: string, v: string) => { if (!(k in values)) keys.push(k); values[k] = v; (localStorage as unknown as { length: number }).length = keys.length }, removeItem: () => {} })
}
const LAP = 'racing-game:trial:nurburgring:bmw:e0-tstreet-sstock-w0-b0:v1'

afterEach(() => {
  instances.splice(0).forEach((l) => l.dispose())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  accountStore.setState(accountStore.getInitialState(), true)
  leaderboardStore.setState(leaderboardStore.getInitialState(), true)
})

describe('posting and loading', () => {
  it('posts unsent bests before reading the board, and each only once', async () => {
    memory({ [LAP]: '{"lapMs":100000}' })
    accountStore.setState({ status: 'signedIn', player: player('p1'), profile })
    const { client, calls } = fakeClient({ submit_leaderboard_scores: () => ({ data: { accepted: 1, rejected: 0 } }), leaderboard_top: () => ({ data: [row({ is_me: true })] }) })
    const l = loader(client)
    await l.load(QUERY)
    expect(calls.map((c) => c.name)).toEqual(['submit_leaderboard_scores', 'leaderboard_top'])
    expect(calls[0].args.entries).toEqual([{ kind: 'trial', track: 'nurburgring', car: 'bmw', build: 'e0-tstreet-sstock-w0-b0', score: 100_000 }])
    expect(calls[1].args).toEqual({ board_id: 'trial:nurburgring', car_filter: null })
    expect(leaderboardStore.getState()).toMatchObject({ status: 'ready', rows: [{ is_me: true }] })
    await l.load(QUERY)
    expect(calls.filter((c) => c.name === 'submit_leaderboard_scores')).toHaveLength(1)
  })

  it('retries a failed post, and still shows the board', async () => {
    memory({ [LAP]: '{"lapMs":100000}' })
    accountStore.setState({ status: 'signedIn', player: player('p1'), profile })
    let fail = true
    const { client, calls } = fakeClient({ submit_leaderboard_scores: () => ({ error: fail ? { message: 'down' } : null }), leaderboard_top: () => ({ data: [] }) })
    const l = loader(client)
    await l.load(QUERY)
    expect(leaderboardStore.getState().status).toBe('ready')
    fail = false
    await l.load(QUERY)
    expect(calls.filter((c) => c.name === 'submit_leaderboard_scores')).toHaveLength(2)
  })

  it.each([
    ['a guest', { player: null, merged: false }, null],
    ['a player whose save has not merged', { player: 'p1', merged: false }, profile],
    ['a player without a racer profile', { player: 'p1', merged: true }, null],
  ])('posts nothing for %s, but they can read', async (_name, state, racer) => {
    memory({ [LAP]: '{"lapMs":100000}' })
    accountStore.setState({ profile: racer })
    const { client, calls } = fakeClient({ leaderboard_top: () => ({ data: [row()] }) })
    await loader(client, state).load(QUERY)
    expect(calls.map((c) => c.name)).toEqual(['leaderboard_top'])
    expect(leaderboardStore.getState().rows).toHaveLength(1)
  })

  it('a new local best posts shortly after, and refreshes the board on show', async () => {
    vi.useFakeTimers()
    memory({ [LAP]: '{"lapMs":100000}' })
    accountStore.setState({ status: 'signedIn', player: player('p1'), profile })
    const { client, calls } = fakeClient({ submit_leaderboard_scores: () => ({ data: {} }), leaderboard_top: () => ({ data: [] }) })
    const l = loader(client)
    await l.load(QUERY)
    calls.length = 0
    localStorage.setItem(LAP, '{"lapMs":90000}')
    accountStore.setState((s) => ({ localSaves: s.localSaves + 1 }))
    await vi.advanceTimersByTimeAsync(2100)
    expect(calls.map((c) => c.name)).toEqual(['submit_leaderboard_scores', 'leaderboard_top'])
    expect(calls[0].args.entries?.[0].score).toBe(90_000)
  })

  it('a slower board answer never overwrites the newer one', async () => {
    memory({})
    let answerFirst: (v: { data: unknown }) => void = () => {}
    let call = 0
    const client = { rpc: () => ({ abortSignal: () => ++call === 1 ? new Promise((r) => { answerFirst = r }) : Promise.resolve({ data: [row({ display_name: 'Newer' })] }) }) } as unknown as SupabaseClient
    const l = loader(client, { player: null, merged: false })
    const first = l.load(QUERY)
    await vi.waitFor(() => expect(call).toBe(1))
    await l.load({ ...QUERY, track: 'canyon' })
    answerFirst({ data: [row({ display_name: 'Older' })] })
    await first
    expect(leaderboardStore.getState()).toMatchObject({ query: { track: 'canyon' }, rows: [{ display_name: 'Newer' }] })
  })

  it('reports errors and builds without Supabase', async () => {
    memory({})
    await loader(fakeClient({ leaderboard_top: () => ({ error: { message: 'missing' } }) }).client, { player: null, merged: false }).load(QUERY)
    expect(leaderboardStore.getState().status).toBe('error')
    await loader(null, { player: null, merged: false }).load(QUERY)
    expect(leaderboardStore.getState().status).toBe('offline')
  })

  it('reloads the board when the player changes, so "you" is right', async () => {
    memory({})
    const { client, calls } = fakeClient({ leaderboard_top: () => ({ data: [] }) })
    const l = loader(client, { player: null, merged: false })
    await l.load(QUERY)
    calls.length = 0
    accountStore.setState({ status: 'signedIn', player: player('p2') })
    await vi.waitFor(() => expect(calls.map((c) => c.name)).toEqual(['leaderboard_top']))
  })
})

vi.mock('../src/ui/GameContext', () => ({ useGameInstance: () => null }))
vi.mock('../src/ui/hooks', () => ({
  useAccount: (select: (s: ReturnType<typeof accountStore.getState>) => unknown) => select(accountStore.getState()),
  useGame: (select: (s: ReturnType<typeof gameStore.getState>) => unknown) => select(gameStore.getState()),
  useLeaderboard: () => leaderboardStore.getState(),
}))

describe('screens', () => {
  const render = () => renderToStaticMarkup(<Board onAccount={() => {}} onDrive={() => {}} />)
  const showBoard = (rows: LeaderboardRow[], status: 'ready' | 'error' | 'offline' = 'ready') => {
    const { track, driftEvent: event, mode } = gameStore.getState().settings
    leaderboardStore.setState({ query: { mode: mode === 'drift' ? 'drift' : 'timeTrial', track, event, car: null }, status, rows })
  }

  it('shows times, names safely, classes and the player', () => {
    accountStore.setState({ status: 'signedIn', player: player('p1'), profile, profileStatus: 'ready' })
    showBoard([row({ display_name: '<b>Ace</b>' }), row({ rank: 2, score: 101_204, is_me: true })])
    const html = render()
    expect(html).toContain('&lt;b&gt;Ace&lt;/b&gt;')
    expect(html).toContain('1:40.000')
    expect(html).toContain('+1.204')
    expect(html).toContain('aria-current="true"')
    expect(html).toContain('<b>P2</b> of 2')
  })

  it('invites guests to sign in, racers without a profile to create one', () => {
    accountStore.setState({ status: 'signedOut' })
    showBoard([])
    expect(render()).toContain('Sign in to put your')
    expect(render()).toContain('No laps on the board yet')
    accountStore.setState({ status: 'signedIn', player: player('p1'), profile: null, profileStatus: 'ready' })
    expect(render()).toContain('Create racer')
  })

  it('has a way forward when the board fails, and a plain note when it can\'t exist', () => {
    showBoard([], 'error')
    expect(render()).toContain('Try again')
    showBoard([], 'offline')
    expect(render()).toContain('available in this build')
  })

  it('never shows another board\'s rows under this title', () => {
    leaderboardStore.setState({ query: { ...QUERY, track: 'not-this-one' }, status: 'ready', rows: [row({ display_name: 'Elsewhere' })] })
    expect(render()).not.toContain('Elsewhere')
  })

  it('results strip: rank and rival, or a nudge for guests', () => {
    const { track, driftEvent: event } = gameStore.getState().settings
    accountStore.setState({ status: 'signedIn', player: player('p1'), profile, profileStatus: 'ready' })
    leaderboardStore.setState({ query: { mode: 'timeTrial', track, event, car: null }, status: 'ready', rows: [row({ display_name: 'Ace', entrants: 9 }), row({ rank: 2, entrants: 9, score: 100_500, is_me: true })] })
    const html = renderToStaticMarkup(<LeaderboardResult mode="timeTrial" />)
    expect(html).toContain('P2')
    expect(html).toContain('0.500 behind Ace')
    leaderboardStore.setState({ rows: [row({ is_me: true, entrants: 1 })] })
    expect(renderToStaticMarkup(<LeaderboardResult mode="timeTrial" />)).toContain('First on the board')
    accountStore.setState({ status: 'signedOut', player: null, profile: null })
    expect(renderToStaticMarkup(<LeaderboardResult mode="timeTrial" />)).toContain('Sign in from the main menu')
  })
})
