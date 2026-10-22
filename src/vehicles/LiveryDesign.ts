import type { PlateStyle } from './PlateStyles'
export type StripePattern = 'none' | 'center' | 'twin' | 'offset' | 'chevron' | 'triple' | 'sash' | 'pinstripe'
export type NumberPanel = 'none' | 'roundel' | 'square'
export type LiveryDecal = 'none' | 'bolt' | 'chequer' | 'apex' | 'star' | 'target' | 'speed'

/** Pure build data: saved alongside paint/upgrades, independent of renderer or UI. */
export interface LiveryDesign {
  plateEnabled: boolean
  plateText: string
  plateStyle: PlateStyle
  pattern: StripePattern
  primary: string
  accent: string
  number: number
  hoodNumber: boolean
  panel: NumberPanel
  decal: LiveryDecal
}

export const DEFAULT_LIVERY: LiveryDesign = {
  plateEnabled: false, plateText: 'APEX 911', plateStyle: 'midnight',
  pattern: 'none', primary: '#f2f2ed', accent: '#f4c400', number: 7, hoodNumber: false, panel: 'none', decal: 'none',
}

export function sanitizeLivery(raw: unknown): LiveryDesign {
  const value = raw && typeof raw === 'object' ? raw as Partial<LiveryDesign> : {}
  const color = (input: unknown, fallback: string) => typeof input === 'string' && /^#[0-9a-f]{6}$/i.test(input) ? input : fallback
  return {
    plateEnabled: value.plateEnabled === true,
    plateText: typeof value.plateText === 'string' ? value.plateText.toUpperCase().replace(/[^A-Z0-9 -]/g, '').slice(0, 8) : DEFAULT_LIVERY.plateText,
    plateStyle: ['classic', 'euro', 'midnight', 'heritage'].includes(value.plateStyle ?? '') ? value.plateStyle! : DEFAULT_LIVERY.plateStyle,
    pattern: ['none', 'center', 'twin', 'offset', 'chevron', 'triple', 'sash', 'pinstripe'].includes(value.pattern ?? '') ? value.pattern! : DEFAULT_LIVERY.pattern,
    primary: color(value.primary, DEFAULT_LIVERY.primary),
    accent: color(value.accent, DEFAULT_LIVERY.accent),
    number: typeof value.number === 'number' && Number.isFinite(value.number) ? Math.max(0, Math.min(999, Math.round(value.number))) : DEFAULT_LIVERY.number,
    hoodNumber: value.hoodNumber === true,
    panel: ['none', 'roundel', 'square'].includes(value.panel ?? '') ? value.panel! : DEFAULT_LIVERY.panel,
    decal: ['none', 'bolt', 'chequer', 'apex', 'star', 'target', 'speed'].includes(value.decal ?? '') ? value.decal! : DEFAULT_LIVERY.decal,
  }
}

export function hasLivery(design: LiveryDesign): boolean {
  return design.pattern !== 'none' || design.panel !== 'none' || design.hoodNumber || design.decal !== 'none'
}

/** Metres in the rigged body's frame (+Z forward, +X left); no shared UV assumption. */
export interface LiveryPlacement {
  paintAliases: readonly string[]
  stripeWidth: number
  stripeGap: number
  stripeOffset: number
  topMinY: number
  hoodZ: number
  hoodWidth: number
  panelY: number
  panelZ: number
  panelWidth: number
  panelHeight: number
  decalZ: number
  decalWidth: number
}

export const LIVERY_PLACEMENTS: Readonly<Record<string, LiveryPlacement>> = {
  porsche911: { hoodZ: 1.35, hoodWidth: .55, paintAliases: [], stripeWidth: .09, stripeGap: .15, stripeOffset: -.32, topMinY: .72, panelY: .76, panelZ: .05, panelWidth: .64, panelHeight: .44, decalZ: -.72, decalWidth: .36 },
  bmw: { hoodZ: 1.25, hoodWidth: .6, paintAliases: ['Mat.3'], stripeWidth: .1, stripeGap: .17, stripeOffset: -.34, topMinY: .68, panelY: .73, panelZ: .04, panelWidth: .68, panelHeight: .42, decalZ: -.79, decalWidth: .4 },
  diablo: { hoodZ: 1.65, hoodWidth: .55, paintAliases: ['WC_TEAM_BODY1_PA.001'], stripeWidth: .09, stripeGap: .15, stripeOffset: -.32, topMinY: .64, panelY: .64, panelZ: .1, panelWidth: .6, panelHeight: .36, decalZ: -.8, decalWidth: .34 },
  amg: { hoodZ: 1.0, hoodWidth: .55, paintAliases: ['amgMercedesAMG_GT3_2020Paint_Material1'], stripeWidth: .09, stripeGap: .15, stripeOffset: -.32, topMinY: .74, panelY: .62, panelZ: .05, panelWidth: .64, panelHeight: .4, decalZ: -.9, decalWidth: .36 },
  charger: { hoodZ: 1.6, hoodWidth: .6, paintAliases: ['vehicle_generic_smallspecmap_PRIMARY'], stripeWidth: .1, stripeGap: .17, stripeOffset: -.34, topMinY: .8, panelY: .62, panelZ: .1, panelWidth: .7, panelHeight: .42, decalZ: -1.1, decalWidth: .4 },
  koenigsegg: { hoodZ: 1.28, hoodWidth: .48, paintAliases: [], stripeWidth: .085, stripeGap: .14, stripeOffset: -.3, topMinY: .56, panelY: .6, panelZ: .03, panelWidth: .58, panelHeight: .34, decalZ: -.64, decalWidth: .32 },
}
