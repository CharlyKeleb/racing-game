/**
 * Every playable car. Adding a car = run it through the Blender MCP pipeline,
 * drop `<id>.glb` + `vehicle-config.json` in public/models/cars/<id>/, add a row.
 */
export interface CarEntry {
  id: string
  name: string
  modelUrl: string
  /** Simplified mesh for the Low preset (npm run build:car-lod). */
  modelUrlLow?: string
  configUrl: string
  /** Engine recordings folder (engine-bank.wav/.json, ignition, lift-off); procedural engine if absent. */
  audioUrl?: string
}

export const CARS: CarEntry[] = [
  {
    id: 'porsche911',
    name: 'Porsche 911 Carrera 4S',
    modelUrl: '/models/cars/porsche911/porsche911.glb',
    modelUrlLow: '/models/cars/porsche911/porsche911_low.glb',
    configUrl: '/models/cars/porsche911/vehicle-config.json',
    audioUrl: '/audio/porsche911/',
  },
  {
    id: 'mclaren',
    name: 'McLaren',
    modelUrl: '/models/cars/mclaren/mclaren.glb',
    configUrl: '/models/cars/mclaren/vehicle-config.json',
  },
]

export function getCar(id: string): CarEntry {
  return CARS.find((c) => c.id === id) ?? CARS[0]
}
