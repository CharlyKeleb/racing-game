import { Surface } from '../vehicles/Surface'

/** Full surface coverage, independent of the race centreline (pit lanes and side roads included). */
export interface MinimapRaster {
  x: number
  z: number
  cellSize: number
  width: number
  height: number
  cells: Uint8Array
}

/** Bounded overview; a narrow paved road survives downsampling over adjacent scenery. */
export function buildMinimapRaster(info: { x0: number; z0: number; res: number; width: number; height: number }, cells: Uint8Array, limit = 768): MinimapRaster {
  const stride = Math.max(1, Math.ceil(Math.max(info.width, info.height) / Math.max(1, limit)))
  const width = Math.ceil(info.width / stride), height = Math.ceil(info.height / stride)
  const overview = new Uint8Array(width * height)
  const priority = [0, 6, 5, 1, 2, 3]
  for (let z = 0; z < info.height; z++) for (let x = 0; x < info.width; x++) {
    const surface = cells[z * info.width + x] ?? Surface.None
    const index = Math.floor(z / stride) * width + Math.floor(x / stride)
    if ((priority[surface] ?? 0) > priority[overview[index]]) overview[index] = surface
  }
  return { x: info.x0, z: info.z0, cellSize: info.res * stride, width, height, cells: overview }
}
