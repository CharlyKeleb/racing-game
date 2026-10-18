import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { TRACKS } from '../src/world/tracks'

// New circuits must ship a real, decodable aerial rather than falling back to runtime geometry.
describe('shipped aerial previews', () => {
  for (const track of TRACKS) {
    it(`${track.id} has a compact full-resolution WebP`, async () => {
      const file = readFileSync(`public/previews/tracks/${track.id}.webp`)
      const metadata = await sharp(file).metadata()
      expect(metadata.format).toBe('webp')
      expect(metadata.width).toBe(1600)
      expect(metadata.height).toBe(1040)
      expect(file.byteLength).toBeLessThan(300_000)
    })
  }
})
