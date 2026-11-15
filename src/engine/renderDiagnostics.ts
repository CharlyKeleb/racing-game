import type { QualityPreset } from '../stores/gameStore'

/** Fixed-DPR A/B controls are unavailable without the explicit capture opt-in. */
export function readRenderDiagnostics(search: string) {
  const query = new URLSearchParams(search)
  const enabled = query.get('perf') === '1'
  const ratio = Number(query.get('perfDpr'))
  const fxQuality = query.get('perfFxQuality')
  return {
    postfxQuality: enabled && (fxQuality === 'low' || fxQuality === 'medium' || fxQuality === 'high' || fxQuality === 'ultra') ? fxQuality as QualityPreset : null,
    fixedDpr: enabled && Number.isFinite(ratio) && ratio >= .5 && ratio <= 2 ? ratio : null,
    shadowsOff: enabled && query.get('perfShadows') === '0',
    postfxOff: enabled && query.get('perfPostfx') === '0',
  }
}
export const renderDiagnostics = readRenderDiagnostics(typeof location === 'undefined' ? '' : location.search)
