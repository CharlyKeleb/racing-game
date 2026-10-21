import { buildStats, carClass, performanceRank, sanitizeBuild, type BuildStats, type CarBuild, type CarClass } from './CarBuild'

/**
 * Named garage setups per car (#35): paint, wheels, livery and upgrades saved
 * together. Pure list operations; gameStore persists them. Each car keeps its
 * own list, so switching cars never touches another car's presets.
 */

export interface BuildPreset {
  id: string
  name: string
  build: CarBuild
}

/** Saved presets per car, besides the fixed Stock setup. */
export const PRESET_SLOTS = 5
export const PRESET_NAME_MAX = 24

/** Trimmed, length-capped, never empty. */
export function presetName(raw: string, fallback = 'Setup'): string {
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX)
  return name || fallback
}

/** The next free "Setup N" name for a list. */
export function nextPresetName(list: readonly BuildPreset[]): string {
  for (let n = 1; ; n++) if (!list.some((p) => p.name === `Setup ${n}`)) return `Setup ${n}`
}

export function addPreset(list: readonly BuildPreset[], id: string, name: string, build: CarBuild): BuildPreset[] {
  if (list.length >= PRESET_SLOTS) return [...list]
  return [...list, { id, name: presetName(name, nextPresetName(list)), build }]
}

export function renamePreset(list: readonly BuildPreset[], id: string, name: string): BuildPreset[] {
  return list.map((p) => (p.id === id ? { ...p, name: presetName(name, p.name) } : p))
}

/** A copy right after the original, named "… copy". No-op when the slots are full. */
export function duplicatePreset(list: readonly BuildPreset[], id: string, newId: string): BuildPreset[] {
  const i = list.findIndex((p) => p.id === id)
  if (i < 0 || list.length >= PRESET_SLOTS) return [...list]
  const copy = { id: newId, name: presetName(`${list[i].name.slice(0, PRESET_NAME_MAX - 5)} copy`), build: list[i].build }
  return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)]
}

export function deletePreset(list: readonly BuildPreset[], id: string): BuildPreset[] {
  return list.filter((p) => p.id !== id)
}

/** Stored presets → valid lists per car (bad entries dropped, builds sanitized, slots capped). */
export function sanitizePresets(raw: unknown): Record<string, BuildPreset[]> {
  const out: Record<string, BuildPreset[]> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [car, list] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue
    const valid: BuildPreset[] = []
    for (const p of list) {
      if (!p || typeof p !== 'object' || typeof (p as BuildPreset).id !== 'string') continue
      if (valid.some((v) => v.id === (p as BuildPreset).id)) continue
      valid.push({ id: (p as BuildPreset).id, name: presetName(String((p as BuildPreset).name ?? '')), build: sanitizeBuild((p as BuildPreset).build) })
      if (valid.length === PRESET_SLOTS) break
    }
    out[car] = valid
  }
  return out
}

/** Same setup, ignoring object identity. */
export function sameBuild(a: CarBuild, b: CarBuild): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface PresetPreview {
  rank: number
  carClass: CarClass
  rankDelta: number
  /** Stat changes against the current build, -1..1 per stat. */
  stats: { key: keyof BuildStats; label: string; value: number; delta: number }[]
}

const STAT_LABELS: [keyof BuildStats, string][] = [['power', 'Power'], ['grip', 'Grip'], ['handling', 'Handling'], ['braking', 'Braking']]

/** What applying `target` would change, before you apply it. */
export function previewPreset(current: CarBuild, target: CarBuild, stock?: BuildStats): PresetPreview {
  const now = buildStats(current, stock), next = buildStats(target, stock)
  const rank = performanceRank(target, stock)
  return {
    rank,
    carClass: carClass(rank),
    rankDelta: rank - performanceRank(current, stock),
    stats: STAT_LABELS.map(([key, label]) => ({ key, label, value: next[key], delta: next[key] - now[key] })),
  }
}
