import { describe, expect, it } from 'vitest'
import { StagingRevs } from '../src/audio/StagingRevs'
import { DEFAULT_LAUNCH, LaunchControl, type LaunchInput } from '../src/racing/LaunchControl'
import { COUNTDOWN_SEC } from '../src/racing/RaceManager'

const DT = 1 / 60
const IN_BAND = (DEFAULT_LAUNCH.bandLow + DEFAULT_LAUNCH.bandHigh) / 2

function input(patch: Partial<LaunchInput>): LaunchInput {
  return { phase: 'staging', revs: IN_BAND, throttle: 1, hold: false, assist: false, ...patch }
}

/**
 * Drive a full start at a fixed step: `pressAt` / `releaseAt` are seconds from
 * the start of the countdown (lights out at COUNTDOWN_SEC). Ticks counted as
 * integers so the boundary sits exactly on a tick.
 */
function run(opts: { pressAt?: number; releaseAt?: number; revs?: number; throttle?: number; assist?: boolean; heldFromBefore?: boolean; dt?: number }): LaunchControl {
  const dt = opts.dt ?? DT
  const launch = new LaunchControl()
  launch.reset()
  const goTick = Math.round(COUNTDOWN_SEC / dt)
  const total = goTick + Math.round(1.5 / dt)
  for (let tick = 0; tick < total; tick++) {
    const t = tick * dt
    const pressed = opts.heldFromBefore || (opts.pressAt !== undefined && t >= opts.pressAt - 1e-9)
    const hold = pressed && !(opts.releaseAt !== undefined && t >= opts.releaseAt - 1e-9)
    launch.update(dt, input({ phase: tick < goTick ? 'staging' : 'go', revs: opts.revs ?? IN_BAND, throttle: opts.throttle ?? 1, hold, assist: opts.assist ?? false }))
  }
  return launch
}

describe('launch control', () => {
  it('grades a quick release from the band as perfect, a slower one good, a late one poor', () => {
    expect(run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.1 }).grade).toBe('perfect')
    expect(run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.3 }).grade).toBe('good')
    expect(run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.6 }).grade).toBe('poor')
  })

  it('sits exactly on the reaction boundaries at the fixed step', () => {
    const perfect = DEFAULT_LAUNCH.perfectReactionSec
    // Released on the tick that reaches the limit: still perfect. One tick later: good.
    expect(run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + perfect }).grade).toBe('perfect')
    expect(run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + perfect + DT }).grade).toBe('good')
    const good = DEFAULT_LAUNCH.goodReactionSec
    expect(run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + good }).grade).toBe('good')
    expect(run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + good + DT }).grade).toBe('poor')
    // Released on the lights-out tick itself is a zero reaction.
    const zero = run({ pressAt: 1, releaseAt: COUNTDOWN_SEC })
    expect(zero.grade).toBe('perfect')
    expect(zero.reaction).toBe(0)
  })

  it('grades the same at any tick rate (timing, not frames)', () => {
    for (const dt of [1 / 60, 1 / 120, 1 / 30]) {
      expect(run({ dt, pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.1 }).grade).toBe('perfect')
      expect(run({ dt, pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.3 }).grade).toBe('good')
    }
  })

  it('needs the revs in the band at lights-out', () => {
    const low = run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.1, revs: 0.2 })
    expect(low.grade).toBe('poor')
    const limiter = run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.1, revs: 0.98 })
    expect(limiter.grade).toBe('poor')
    // Just outside the band still makes a good launch.
    expect(run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.1, revs: DEFAULT_LAUNCH.bandHigh + 0.04 }).grade).toBe('good')
  })

  it('needs the revs held in the band, not flicked in on the last tick', () => {
    const launch = new LaunchControl()
    launch.reset()
    const goTick = Math.round(COUNTDOWN_SEC / DT)
    for (let tick = 0; tick < goTick + 30; tick++) {
      const revs = tick >= goTick - 3 ? IN_BAND : 0.2
      launch.update(DT, input({ phase: tick < goTick ? 'staging' : 'go', revs, hold: tick > 30 && tick < goTick + 3 }))
    }
    expect(launch.grade).toBe('good')
  })

  it('a release before lights-out is an early (normal) start with no push', () => {
    const launch = run({ pressAt: 1, releaseAt: COUNTDOWN_SEC - 0.05 })
    expect(launch.grade).toBe('early')
    expect(launch.push).toBe(0)
  })

  it('arms from a press made in the intro, before the countdown', () => {
    const launch = new LaunchControl()
    launch.reset()
    for (let i = 0; i < 30; i++) launch.update(DT, input({ phase: 'other', hold: i > 10 }))
    const goTick = Math.round(COUNTDOWN_SEC / DT)
    for (let tick = 0; tick <= goTick + 5; tick++) launch.update(DT, input({ phase: tick < goTick ? 'staging' : 'go', hold: tick < goTick + 5 }))
    expect(launch.grade).toBe('perfect')
  })

  it('never arms from a hold carried in from before the race (menu, previous screen)', () => {
    const launch = run({ heldFromBefore: true, releaseAt: COUNTDOWN_SEC + 0.1 })
    expect(launch.grade).toBe('none')
    expect(launch.push).toBe(0)
  })

  it('without a launch held, the start is just normal', () => {
    const launch = run({})
    expect(launch.grade).toBe('none')
    expect(launch.push).toBe(0)
  })

  it('times out to a poor launch if the hold is never released, never a stall', () => {
    const launch = run({ pressAt: 1 })
    expect(launch.grade).toBe('poor')
    expect(launch.push).toBeLessThan(0)
    expect(launch.push).toBeGreaterThan(-1.5)
  })

  it('grants the reward once per start and it fades out', () => {
    const launch = new LaunchControl()
    launch.reset()
    const goTick = Math.round(COUNTDOWN_SEC / DT)
    let peak = 0
    let pushedTicks = 0
    // Re-pressing and releasing after the launch must not grant a second one.
    for (let tick = 0; tick < goTick + 300; tick++) {
      const hold = (tick > 60 && tick < goTick + 4) || (tick % 20 < 10 && tick > goTick + 10)
      launch.update(DT, input({ phase: tick < goTick ? 'staging' : 'go', hold }))
      peak = Math.max(peak, launch.push)
      if (launch.push > 0) pushedTicks++
    }
    expect(launch.grade).toBe('perfect')
    expect(peak).toBeCloseTo(DEFAULT_LAUNCH.perfectAccel)
    expect(pushedTicks).toBeLessThanOrEqual(Math.round(DEFAULT_LAUNCH.durationSec / DT))
    expect(launch.push).toBe(0)
  })

  it('pause around lights-out cancels the launch for good', () => {
    const launch = new LaunchControl()
    launch.reset()
    const goTick = Math.round(COUNTDOWN_SEC / DT)
    for (let tick = 0; tick < goTick + 1; tick++) launch.update(DT, input({ phase: tick < goTick ? 'staging' : 'go', hold: tick > 30 }))
    expect(launch.waiting).toBe(true)
    launch.interrupt() // paused after seeing the lights go out
    launch.update(DT, input({ phase: 'go', hold: false }))
    expect(launch.grade).toBe('none')
    expect(launch.push).toBe(0)
  })

  it('pause on the grid disarms: a hold kept down through the pause does not count', () => {
    const launch = new LaunchControl()
    launch.reset()
    const goTick = Math.round(COUNTDOWN_SEC / DT)
    for (let tick = 0; tick < goTick + 30; tick++) {
      if (tick === 120) launch.interrupt()
      launch.update(DT, input({ phase: tick < goTick ? 'staging' : 'go', hold: tick > 30 && tick < goTick + 5 }))
    }
    expect(launch.grade).toBe('none')
    // Releasing and pressing again after the pause re-arms it.
    launch.reset()
    for (let tick = 0; tick < goTick + 30; tick++) {
      if (tick === 120) launch.interrupt()
      launch.update(DT, input({ phase: tick < goTick ? 'staging' : 'go', hold: (tick > 30 && tick < 125) || (tick > 130 && tick < goTick + 5) }))
    }
    expect(launch.grade).toBe('perfect')
  })

  it('a reset (restart) clears a granted launch', () => {
    const launch = run({ pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.1 })
    launch.reset()
    expect(launch.grade).toBe('none')
    expect(launch.push).toBe(0)
  })

  it('launch assist gives a good launch from the throttle alone, never perfect', () => {
    expect(run({ assist: true }).grade).toBe('good')
    expect(run({ assist: true, pressAt: 1, releaseAt: COUNTDOWN_SEC + 0.05 }).grade).toBe('good')
    expect(run({ assist: true, throttle: 0 }).grade).toBe('none')
  })

  it('a keyboard driver can hold the band by feathering the throttle', () => {
    const revs = new StagingRevs(0)
    revs.reset(1000)
    const launch = new LaunchControl()
    launch.reset()
    const goTick = Math.round(COUNTDOWN_SEC / DT)
    for (let tick = 0; tick < goTick + 30; tick++) {
      const share = (revs.rpm - 1000) / 7200
      const pedal = share < 0.72 ? 1 : 0
      if (tick < goTick) revs.update(DT, 1000, 8200, 0, pedal)
      launch.update(DT, input({ phase: tick < goTick ? 'staging' : 'go', revs: (revs.rpm - 1000) / 7200, throttle: 1, hold: tick > 30 && tick < goTick + 6 }))
    }
    expect(launch.grade).toBe('perfect')
    // Flat out on a key overshoots the band: still a good launch, not perfect.
    revs.reset(1000)
    for (let i = 0; i < 120; i++) revs.update(DT, 1000, 8200, 0, 1)
    expect(launch.inBand((revs.rpm - 1000) / 7200)).toBe(false)
  })
})
