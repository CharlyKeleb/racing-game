import { Game } from '../../src/engine/Game'

/**
 * A callable, infinitely deep no-op: every property is another stub, every call
 * returns one, and it reads as 0 / '' in arithmetic and strings. Never thenable,
 * so `await stub` resolves straight away.
 */
export function stub(): unknown {
  const children = new Map<PropertyKey, unknown>()
  const target = function () {} as unknown as object
  return new Proxy(target, {
    get(_t, key) {
      if (key === 'then') return undefined
      if (key === Symbol.toPrimitive) return (hint: string) => (hint === 'string' ? '' : 0)
      if (key === Symbol.iterator) return function* () {}
      if (!children.has(key)) children.set(key, stub())
      return children.get(key)
    },
    apply: () => stub(),
    construct: () => stub() as object,
  })
}

export type TestGame = Game & Record<string, any>

/**
 * A Game for command / orchestration tests, built without WebGL, audio or
 * physics (no constructor run). Give it the fields the test cares about; any
 * other field a method reads becomes a stub instead of `undefined`, so adding a
 * field to Game no longer breaks unrelated tests (#49).
 *
 * Stubs are truthy: pass every flag the code under test branches on
 * (`disposed`, `raceQueued`, …) explicitly. `stubbed` lists the auto-filled
 * names, for debugging a test that behaves unexpectedly.
 */
export function makeTestGame(fields: Record<string, unknown> = {}): TestGame & { stubbed: Set<string> } {
  const stubbed = new Set<string>()
  const base = Object.assign(Object.create(Game.prototype), { disposed: false, onlineRaceId: null, onlineEnding: false }, fields, { stubbed })
  return new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key === 'symbol' || key in target) return Reflect.get(target, key, receiver)
      stubbed.add(key)
      const value = stub()
      target[key] = value
      return value
    },
  })
}
