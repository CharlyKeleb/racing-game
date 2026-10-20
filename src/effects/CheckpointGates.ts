import * as THREE from 'three'

/** A gate across the road: on the centreline, facing the race direction, as wide as the paved road. */
export interface GateSpot {
  index: number
  position: THREE.Vector3
  heading: number
  /** Paved road either side of the centreline, m (+X / left first). */
  left: number
  right: number
}

/** Pillar height and the banner across the top, m. */
const HEIGHT = 5.2
const BANNER_H = 1.1
/** Widest a gate gets either side of the line, m. */
const MAX_SIDE = 12
const NEXT = new THREE.Color(0x2de0ff)
const FINISH = new THREE.Color(0xffd447)

/**
 * Time Trial checkpoints, NFS style: a glowing arch over the road at the next
 * gate, a dimmer one at the gate after it, and a banner that names it. Only two
 * are ever shown (≈8 draw calls). Plain MeshBasicMaterial, so the WebGPU
 * renderer needs no node twin.
 */
export class CheckpointGates {
  readonly group = new THREE.Group()
  private readonly gates: THREE.Group[] = []
  private readonly materials: THREE.MeshBasicMaterial[] = []
  private readonly textures: THREE.Texture[] = []
  private readonly geometries: THREE.BufferGeometry[] = []
  private time = 0
  private next = -1

  constructor(checkpoints: readonly GateSpot[]) {
    const pillar = new THREE.BoxGeometry(0.5, HEIGHT, 0.5)
    const banner = new THREE.PlaneGeometry(1, BANNER_H)
    const stripe = new THREE.PlaneGeometry(1, 0.6)
    this.geometries.push(pillar, banner, stripe)
    const count = checkpoints.length
    for (const cp of checkpoints) {
      const gate = new THREE.Group()
      gate.position.copy(cp.position)
      gate.rotation.y = cp.heading
      // Local +X is the left of travel (glTF), so the left pillar stands at +left.
      const left = Math.min(cp.left, MAX_SIDE) + 0.5, right = Math.min(cp.right, MAX_SIDE) + 0.5
      const centre = (left - right) / 2, width = left + right
      const finish = cp.index === 0
      const glow = new THREE.MeshBasicMaterial({ color: finish ? FINISH : NEXT, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending })
      const texture = bannerTexture(finish ? 'FINISH' : `CHECKPOINT ${cp.index}/${count - 1}`, finish ? '#ffd447' : '#2de0ff')
      const sign = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
      this.materials.push(glow, sign)
      this.textures.push(texture)
      for (const x of [left, -right]) {
        const p = new THREE.Mesh(pillar, glow)
        p.position.set(x, HEIGHT / 2, 0)
        gate.add(p)
      }
      // Keep the texture's 8:1 aspect so the lettering isn't stretched on wide gates.
      const b = new THREE.Mesh(banner, sign)
      const bannerW = width + 0.5
      b.scale.set(bannerW, bannerW / 8 / BANNER_H, 1)
      b.position.set(centre, HEIGHT - bannerW / 16, 0)
      // The plane faces +Z (travel); turn it round so the approaching driver reads it.
      b.rotation.y = Math.PI
      gate.add(b)
      const s = new THREE.Mesh(stripe, glow)
      s.scale.x = width
      s.position.x = centre
      s.rotation.x = -Math.PI / 2
      s.position.y = 0.08
      gate.add(s)
      gate.visible = false
      this.gates.push(gate)
      this.group.add(gate)
    }
    this.group.visible = false
  }

  /** Show the gate the car must pass next (bright, pulsing) and the one after it (dim). */
  update(visible: boolean, next: number, dt: number): void {
    this.group.visible = visible && this.gates.length > 0
    if (!this.group.visible) return
    this.time += dt
    const n = this.gates.length
    const after = (next + 1) % n
    if (next !== this.next) {
      this.next = next
      this.gates.forEach((gate, i) => { gate.visible = i === next || i === after })
    }
    const pulse = 0.7 + 0.25 * Math.sin(this.time * 6)
    for (let i = 0; i < n; i++) {
      if (!this.gates[i].visible) continue
      const near = i === next
      this.materials[i * 2].opacity = near ? pulse : 0.25
      this.materials[i * 2 + 1].opacity = near ? 1 : 0.35
    }
  }

  dispose(): void {
    this.group.removeFromParent()
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
    for (const t of this.textures) t.dispose()
  }
}

function bannerTexture(text: string, color: string): THREE.Texture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = 'rgba(4, 12, 20, 0.82)'
    ctx.fillRect(0, 0, 512, 64)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, 512, 4)
    ctx.fillRect(0, 60, 512, 4)
    ctx.font = 'italic 900 36px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, 256, 34)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}
