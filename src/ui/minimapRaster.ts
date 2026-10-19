import type { MinimapRaster } from '../world/MinimapData'

/** Roads retain contrast; grass/runoff are deliberately muted and darker. */
export const MINIMAP_PALETTE: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0], [107, 124, 137, 255], [120, 132, 140, 255],
  [27, 43, 43, 255], [49, 46, 42, 255], [42, 48, 51, 255],
]
export function minimapPixels(data: MinimapRaster): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(data.width * data.height * 4)
  for (let i = 0; i < data.cells.length; i++) pixels.set(MINIMAP_PALETTE[data.cells[i]] ?? MINIMAP_PALETTE[0], i * 4)
  return pixels
}

const images = new WeakMap<MinimapRaster, string>()

/** One cached image per track; telemetry only transforms the image and route. */
export function minimapRasterUrl(data: MinimapRaster): string {
  const cached = images.get(data)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = data.width; canvas.height = data.height
  const context = canvas.getContext('2d')
  if (!context) return ''
  const image = context.createImageData(data.width, data.height)
  image.data.set(minimapPixels(data))
  context.putImageData(image, 0, 0)
  const imageUrl = canvas.toDataURL('image/png')
  images.set(data, imageUrl)
  return imageUrl
}
