import * as THREE from 'three'
import type { CarModel } from './CarModel'
import type { LiveryDesign } from './LiveryDesign'

import { PLATE_STYLES } from './PlateStyles'

/** Original plate artwork on a solid, rounded metal plate; attached to the leaning body. */
export class LicensePlate {
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private readonly material: THREE.MeshPhysicalMaterial
  private readonly edgeMaterial = new THREE.MeshStandardMaterial({ color: '#303238', metalness: .35, roughness: .6 })
  private readonly geometry: THREE.ExtrudeGeometry
  private readonly plates: THREE.Mesh[] = []
  private key = ''

  constructor(model: CarModel) {
    this.canvas.width = 1024; this.canvas.height = 256
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
    this.material = new THREE.MeshPhysicalMaterial({ map: this.texture, roughness: .48, metalness: .05, clearcoat: .18, clearcoatRoughness: .4, bumpMap: this.texture, bumpScale: .0002 })
    const shape = new THREE.Shape()
    const w = .26, h = .065, r = .006
    shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h)
    shape.quadraticCurveTo(w, -h, w, -h + r); shape.lineTo(w, h - r)
    shape.quadraticCurveTo(w, h, w - r, h); shape.lineTo(-w + r, h)
    shape.quadraticCurveTo(-w, h, -w, h - r); shape.lineTo(-w, -h + r)
    shape.quadraticCurveTo(-w, -h, -w + r, -h)
    this.geometry = new THREE.ExtrudeGeometry(shape, { depth: .0015, bevelEnabled: true, bevelSize: .0008, bevelThickness: .0005, bevelSegments: 2, steps: 1 })
    // Extrude's default UVs are metres; map the front/back faces to the full artwork.
    const position = this.geometry.getAttribute('position'), uv = this.geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i++) uv.setXY(i, (position.getX(i) + w) / (2 * w), (position.getY(i) + h) / (2 * h))
    // Individual mounts follow the plate pocket rather than the outer bumper lip.
    const mounts: Record<string, { front: [number, number, number]; rear: [number, number, number] }> = {
      porsche911: { front: [0, .41, 2.270], rear: [0, .6, -2.239] },
      bmw: { front: [0, .4, 2.125], rear: [0, .665, -2.289] },
      koenigsegg: { front: [0, .32, 2.264], rear: [0, .56, -2.023] },
      diablo: { front: [0, .4, 2.19], rear: [0, .5, -2.33] },
      amg: { front: [0, .4, 2.23], rear: [0, .55, -2.31] },
      charger: { front: [0, .45, 2.4], rear: [0, .55, -2.68] },
    }
    const mount = mounts[model.root.name]
    if (!mount) return
    for (const side of ['front', 'rear'] as const) {
      const plate = new THREE.Mesh(this.geometry, [this.material, this.edgeMaterial])
      plate.name = `CustomPlate_${side}`
      plate.position.set(...mount[side])
      plate.rotation.y = side === 'rear' ? Math.PI : 0
      // E36 pocket is shallower and shorter than a universal plate.
      if (model.root.name === 'bmw' && side === 'rear') plate.scale.set(.93, .8, 1)
      plate.castShadow = true; plate.receiveShadow = true; plate.visible = false
      model.body.add(plate); this.plates.push(plate)
    }
  }

  apply(design: LiveryDesign): void {
    for (const plate of this.plates) plate.visible = design.plateEnabled
    const key = `${design.plateText}:${design.plateStyle}`
    if (!design.plateEnabled || key === this.key) return
    this.key = key
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const style = PLATE_STYLES[design.plateStyle]
    ctx.fillStyle = style.background; ctx.fillRect(0, 0, 1024, 256)
    ctx.strokeStyle = style.ink; ctx.globalAlpha = .25; ctx.lineWidth = 2
    ctx.strokeRect(12, 12, 1000, 232); ctx.globalAlpha = 1
    const euro = design.plateStyle === 'euro'
    if (euro) {
      ctx.fillStyle = style.band; ctx.fillRect(0, 0, 88, 256)
      ctx.fillStyle = '#f5ce55'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('✦', 44, 70); ctx.fillStyle = '#ffffff'; ctx.fillText('GT', 44, 202)
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillStyle = style.band; ctx.font = design.plateStyle === 'classic' ? 'italic bold 39px cursive' : 'bold 27px sans-serif'
    ctx.fillText(style.caption, euro ? 554 : 512, 42)
    ctx.fillStyle = style.ink; ctx.font = 'bold 138px monospace'
    ctx.shadowColor = '#00000030'; ctx.shadowOffsetY = 1; ctx.shadowBlur = 1
    ctx.fillText(design.plateText || 'YOUR TAG', euro ? 554 : 512, 145, euro ? 830 : 910)
    ctx.shadowColor = 'transparent'; ctx.shadowOffsetY = 0; ctx.shadowBlur = 0
    ctx.font = 'bold 16px sans-serif'; ctx.globalAlpha = .65
    ctx.fillText('RACING CLUB  •  BUILT TO DRIVE', euro ? 554 : 512, 225); ctx.globalAlpha = 1
    // Small recessed fasteners catch the light without adding more geometry.
    for (const x of [euro ? 112 : 38, 986]) for (const y of [30, 226]) {
      ctx.fillStyle = '#8c9093'; ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#41464b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.stroke()
    }
    // Fine reflective grain breaks up the perfectly flat digital fill.
    ctx.fillStyle = '#ffffff'
    for (let i = 0; i < 1600; i++) {
      ctx.globalAlpha = .025 + (i % 3) * .008
      ctx.fillRect((i * 193) % 1024, (i * 71) % 256, 1, 1)
    }
    ctx.globalAlpha = 1
    this.texture.needsUpdate = true
  }

  dispose(): void {
    for (const plate of this.plates) plate.removeFromParent()
    this.geometry.dispose(); this.material.dispose(); this.edgeMaterial.dispose(); this.texture.dispose()
  }
}
