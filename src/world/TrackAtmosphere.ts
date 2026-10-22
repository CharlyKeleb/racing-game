import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { QualityPreset } from '../stores/gameStore'
import type { EventSite } from './atmospherePlan'

/** Original track flags, banners and pit furniture. Standard materials work on both renderers. */
export class TrackAtmosphere {
  readonly group = new THREE.Group()
  readonly sources: readonly EventSite[]
  private time = 0
  private quality: QualityPreset = 'low'
  private readonly reduced = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)')
  private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true })
  private readonly flagMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
  private readonly bannerTexture = this.makeBanner()
  private readonly bannerMaterial = new THREE.MeshBasicMaterial({ map: this.bannerTexture, side: THREE.DoubleSide, color: this.bannerTexture ? 0xffffff : 0x16889e })
  private readonly resources: THREE.BufferGeometry[] = []
  private readonly sites: { group: THREE.Group; flags: THREE.Mesh; flagRest: Float32Array; phase: number; animated: boolean }[] = []

  constructor(areas: readonly EventSite[]) {
    this.sources = areas
    this.group.name = 'Track event atmosphere'
    for (let i = 0; i < areas.length; i++) this.build(areas[i], i)
  }

  private geometry(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const merged = mergeGeometries(parts, false)!
    for (const part of parts) part.dispose()
    merged.computeBoundingSphere()
    this.resources.push(merged)
    return merged
  }

  private makeBanner(): THREE.CanvasTexture | null {
    if (typeof document === 'undefined') return null
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#102738'; ctx.fillRect(0, 0, 1024, 128)
    ctx.fillStyle = '#ffca28'; ctx.fillRect(0, 0, 14, 128)
    ctx.font = 'italic 900 60px sans-serif'; ctx.fillStyle = '#edf5f6'
    ctx.fillText('PAPAYA', 36, 88)
    ctx.fillStyle = '#46d2df'; ctx.font = 'bold 28px sans-serif'; ctx.fillText('RACE WEEKEND', 545, 78)
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private piece(parts: THREE.BufferGeometry[], g: THREE.BufferGeometry, x: number, y: number, z: number, colour: number): void {
    if (g.index) { const original = g; g = original.toNonIndexed(); original.dispose() }
    g.translate(x, y, z)
    const c = new THREE.Color(colour), colors = new Float32Array(g.getAttribute('position').count * 3)
    for (let i = 0; i < colors.length; i += 3) { colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); parts.push(g)
  }

  private box(parts: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, h: number, d: number, colour: number): void {
    this.piece(parts, new THREE.BoxGeometry(w, h, d), x, y, z, colour)
  }

  private build(area: EventSite, index: number): void {
    const site = new THREE.Group()
    site.position.set(area.x, area.y, area.z); site.rotation.y = area.heading
    this.group.add(site)
    const parts: THREE.BufferGeometry[] = []
    // Furniture is protected behind a continuous Armco with matching physics.
    for (let rail = 0; rail < 3; rail++) this.box(parts, 0, .4 + rail * .28, -4.3, 18, .22, .16, 0xb7c1c4)
    for (let x = -9; x <= 9; x += 1.8) this.box(parts, x, .65, -4.3, .12, 1.3, .15, 0x596b72)
    for (const x of [-8.3, 8.3]) this.box(parts, x, 2.8, -1.9, .09, 5.6, .09, 0xbfcbd1)
    if (area.pit) {
      // Unmanned pit canopy and equipment cases. No people or empty grandstands.
      this.box(parts, -3, 2.8, 1.4, 6, .18, 3.5, 0x21a5bd)
      for (const x of [-5.7, -.3]) for (const z of [-.1, 3]) this.box(parts, x, 1.4, z, .09, 2.8, .09, 0xbfcbd1)
      for (const x of [-5, -3.4]) {
        this.box(parts, x, .5, 2.2, 1.25, 1, .8, 0x27343c)
        this.box(parts, x, .98, 2.2, 1.3, .05, .85, 0xc5cacc)
        this.box(parts, x, .52, 1.78, .8, .04, .03, 0xf1bd30)
      }
      this.box(parts, -1.2, .55, 2.2, .8, 1.1, .8, 0x485a63)
    }
    site.add(new THREE.Mesh(this.geometry(parts), this.material))
    const bannerGeo = new THREE.PlaneGeometry(16, 1.2)
    this.resources.push(bannerGeo)
    const banner = new THREE.Mesh(bannerGeo, this.bannerMaterial)
    banner.rotation.y = Math.PI; banner.position.set(0, .8, -4.5); site.add(banner)
    const flagParts: THREE.BufferGeometry[] = []
    for (const x of [-8.3, 8.3]) {
      const g = new THREE.PlaneGeometry(1.7, .9, 7, 3).toNonIndexed()
      g.translate(x + .85, 4.85, -1.9)
      const attr = g.getAttribute('position'), c = new THREE.Color(x < 0 ? 0xffc72c : 0x25bad2)
      const colours = new Float32Array(attr.count * 3)
      for (let j = 0; j < attr.count; j++) {
        const stripe = (Math.floor((attr.getX(j) - x) * 5) + Math.floor(attr.getY(j) * 5)) % 2 === 0
        colours[j * 3] = c.r * (stripe ? 1 : .65); colours[j * 3 + 1] = c.g * (stripe ? 1 : .65); colours[j * 3 + 2] = c.b * (stripe ? 1 : .65)
      }
      g.setAttribute('color', new THREE.BufferAttribute(colours, 3)); flagParts.push(g)
    }
    const flags = new THREE.Mesh(this.geometry(flagParts), this.flagMaterial)
    ;(flags.geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage)
    site.add(flags)
    this.sites.push({ group: site, flags, flagRest: new Float32Array(flags.geometry.getAttribute('position').array), phase: index * 2.13, animated: false })
    this.pose(this.sites[this.sites.length - 1])
  }

  private pose(site: typeof this.sites[number]): void {
    const position = site.flags.geometry.getAttribute('position'), rest = site.flagRest
    for (let i = 0; i < position.count; i++) {
      const x = rest[i * 3], y = rest[i * 3 + 1], pole = x < 0 ? -8.3 : 8.3
      const u = (x - pole) / 1.7
      position.setZ(i, rest[i * 3 + 2] + u * (.12 * Math.sin(this.time * 3 + u * 4 + site.phase) + .05 * Math.sin(this.time * 5.3 + y * 3)))
    }
    position.needsUpdate = true
    // Keep precomputed normals: very small fabric displacement, avoiding CPU normal rebuilds.
  }

  setQuality(quality: QualityPreset): void { this.quality = quality }

  update(camera: THREE.Vector3, dt: number, active: boolean, allowMotion = true): void {
    this.group.visible = active
    if (!active) return
    const moving = allowMotion && this.quality !== 'low' && !this.reduced?.matches
    this.time += Math.min(dt, .05)
    const range = this.quality === 'low' ? 130 : this.quality === 'medium' ? 200 : 260
    for (const site of this.sites) {
      const distance = site.group.position.distanceToSquared(camera)
      site.group.visible = distance < range * range
      // Static reduced-motion pose (including flags) even after changing settings.
      if (site.group.visible && dt > 0) {
        if (moving && distance < 110 * 110) { this.pose(site); site.animated = true }
        else if (site.animated) { const time = this.time; this.time = 0; this.pose(site); this.time = time; site.animated = false }
      }
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const geometry of this.resources) geometry.dispose()
    this.material.dispose(); this.flagMaterial.dispose(); this.bannerMaterial.dispose(); this.bannerTexture?.dispose()
  }
}
