/**
 * The rival field for a race: `count` cars drawn at random from `choices` (every selectable car
 * but the player's), each once until all have a seat, then again in a fresh order. Pure; the
 * random source can be passed in for tests.
 */
export function pickRivals<T>(choices: readonly T[], count: number, random: () => number = Math.random): T[] {
  const out: T[] = []
  if (!choices.length) return out
  let bag: T[] = []
  while (out.length < count) {
    if (!bag.length) {
      bag = [...choices]
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1))
        ;[bag[i], bag[j]] = [bag[j], bag[i]]
      }
    }
    out.push(bag.pop()!)
  }
  return out
}
