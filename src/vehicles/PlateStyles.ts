/** Original garage plate artwork palettes, shared by the UI and renderer. */
export type PlateStyle = 'classic' | 'euro' | 'midnight' | 'heritage'
export const PLATE_STYLES: Record<PlateStyle, { name: string; background: string; ink: string; band: string; caption: string }> = {
  classic: { name: 'California', background: '#f2eee1', ink: '#173567', band: '#b62929', caption: 'California' },
  euro: { name: 'Euro sport', background: '#f4f4ec', ink: '#151920', band: '#154ba5', caption: 'SPORT' },
  midnight: { name: 'Midnight', background: '#151a24', ink: '#e9c87e', band: '#ba9651', caption: 'NIGHT DRIVE' },
  heritage: { name: 'Heritage', background: '#edb83b', ink: '#1a2025', band: '#1a2025', caption: 'GRAND TOURING' },
}

