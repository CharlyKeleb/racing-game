import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

/**
 * The garage behind the menu and garage screens: a dark hangar with a mirror-
 * gloss concrete floor, a honeycomb light ceiling, light beams, haze and dust,
 * an LED logo wall, a roll-up door and workshop props. Everything is built
 * from primitives and canvas textures, so it needs no downloaded assets.
 *
 * While active, the track, sky and sun are hidden, and the scene's fog,
 * background and reflection map are swapped for the garage's own (the car's
 * paint reflects this room, baked once into a PMREM environment).
 */

const W = 28 // room width (x), m
const D = 24 // room depth (z), m
const H = 8.5 // ceiling height, m
const BACKGROUND = new THREE.Color(0x05070b)
const HEX_R = 0.95 // honeycomb cell radius

export class Showroom {
  readonly group = new THREE.Group()
  private readonly renderer: THREE.WebGLRenderer
  private readonly disposables: { dispose(): void }[] = []
  /** Excluded from the environment bake (mirror, haze and particles). */
  private readonly bakeHidden: THREE.Object3D[] = []
  private reflector!: Reflector
  private dust!: THREE.Points
  private envMap: THREE.Texture | null = null
  private saved: { fog: THREE.Scene['fog']; background: THREE.Scene['background']; environment: THREE.Texture | null; intensity: number } | null = null
  private active = false
  private time = 0

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.group.name = 'Showroom'
    this.group.visible = false
    this.buildFloor()
    this.buildPlatform()
    this.buildWalls()
    this.buildLedWall()
    this.buildDoor()
    this.buildCeiling()
    this.buildBeams()
    this.buildProps()
    this.buildDust()
    this.buildLights()
  }

  /** Centers the room on `position`, facing `heading` (yaw, radians). */
  placeAt(position: THREE.Vector3, heading: number): void {
    this.group.position.set(position.x, 0, position.z)
    this.group.rotation.y = heading
  }

  setActive(scene: THREE.Scene, active: boolean, hide: THREE.Object3D[]): void {
    if (active === this.active) return
    this.active = active
    for (const o of hide) o.visible = !active
    if (active) {
      this.envMap ??= this.bakeEnvironment()
      this.saved = { fog: scene.fog, background: scene.background, environment: scene.environment, intensity: scene.environmentIntensity }
      scene.fog = new THREE.FogExp2(0x0a0f18, 0.028)
      scene.background = BACKGROUND
      scene.environment = this.envMap
      scene.environmentIntensity = 1
      this.group.visible = true
    } else if (this.saved) {
      scene.fog = this.saved.fog
      scene.background = this.saved.background
      scene.environment = this.saved.environment
      scene.environmentIntensity = this.saved.intensity
      this.group.visible = false
    }
  }

  /** Per-frame ambience (dust drift, beam shimmer). Cheap; only runs while visible. */
  update(dt: number): void {
    if (!this.active) return
    this.time += dt
    const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += dt * (0.05 + (i % 7) * 0.008)
      arr[i] += Math.sin(this.time * 0.3 + i) * dt * 0.03
      if (arr[i + 1] > H - 1) arr[i + 1] = 0.2
    }
    pos.needsUpdate = true
  }

  /**
   * Renders the room (without the mirror, haze or dust) into a cube map from
   * just above the car, so paint and glass reflect light strips and the LED wall.
   */
  private bakeEnvironment(): THREE.Texture {
    const parent = this.group.parent
    const { position, rotation, visible } = this.group
    const savedPos = position.clone()
    const savedRotY = rotation.y
    const bakeScene = new THREE.Scene()
    bakeScene.background = BACKGROUND
    bakeScene.add(this.group)
    this.group.position.set(0, 0, 0)
    this.group.rotation.y = 0
    this.group.visible = true
    for (const o of this.bakeHidden) o.visible = false

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const target = pmrem.fromScene(bakeScene, 0.03, 0.1, 60, { size: 256, position: new THREE.Vector3(0, 1.2, 0) })
    pmrem.dispose()
    this.disposables.push(target)

    for (const o of this.bakeHidden) o.visible = true
    this.group.position.copy(savedPos)
    this.group.rotation.y = savedRotY
    this.group.visible = visible
    parent?.add(this.group)
    return target.texture
  }

  private keep<T extends { dispose(): void }>(resource: T): T {
    this.disposables.push(resource)
    return resource
  }

  private emissive(color: THREE.ColorRepresentation, intensity: number): THREE.MeshStandardMaterial {
    return this.keep(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1 }))
  }

  // ── Floor ──────────────────────────────────────────────────────────────

  private buildFloor(): void {
    // Mirror underneath, semi-transparent polished concrete on top = glossy floor.
    const dpr = Math.min(window.devicePixelRatio, 2)
    this.reflector = new Reflector(this.keep(new THREE.PlaneGeometry(W, D)), {
      textureWidth: Math.round(window.innerWidth * dpr * 0.5),
      textureHeight: Math.round(window.innerHeight * dpr * 0.5),
      color: 0x8a8f99,
      clipBias: 0.003,
    })
    this.reflector.rotation.x = -Math.PI / 2
    this.reflector.position.y = 0.001
    this.bakeHidden.push(this.reflector)

    const concrete = this.keep(concreteTexture())
    concrete.wrapS = concrete.wrapT = THREE.RepeatWrapping
    concrete.repeat.set(W / 4, D / 4)
    concrete.colorSpace = THREE.SRGBColorSpace
    const floor = new THREE.Mesh(
      this.keep(new THREE.PlaneGeometry(W, D)),
      this.keep(new THREE.MeshStandardMaterial({ map: concrete, color: 0x9aa0aa, roughness: 0.55, metalness: 0.1, transparent: true, opacity: 0.8 })),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0.004
    floor.receiveShadow = true
    this.group.add(this.reflector, floor)
  }

  /** Hexagonal bay the car sits on: inlay plus glowing outlines, flush with the floor. */
  private buildPlatform(): void {
    const inlay = new THREE.Mesh(
      this.keep(new THREE.CircleGeometry(3.9, 6)),
      this.keep(new THREE.MeshStandardMaterial({ color: 0x0b0d12, roughness: 0.25, metalness: 0.8, transparent: true, opacity: 0.85 })),
    )
    inlay.rotation.set(-Math.PI / 2, 0, Math.PI / 6)
    inlay.position.y = 0.007
    inlay.receiveShadow = true

    const outer = new THREE.Mesh(this.keep(new THREE.RingGeometry(3.9, 4.0, 6)), this.emissive(0xffd200, 3))
    outer.rotation.set(-Math.PI / 2, 0, Math.PI / 6)
    outer.position.y = 0.01
    const inner = new THREE.Mesh(this.keep(new THREE.RingGeometry(3.45, 3.48, 6)), this.emissive(0x19c3ff, 2))
    inner.rotation.copy(outer.rotation)
    inner.position.y = 0.01

    // Chevron markings at the front of the bay.
    const chevronMat = this.emissive(0xffd200, 1.4)
    const chevronGeo = this.keep(new THREE.PlaneGeometry(0.16, 0.9))
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1]) {
        const c = new THREE.Mesh(chevronGeo, chevronMat)
        c.rotation.set(-Math.PI / 2, 0, side * 0.75)
        c.position.set(side * 0.3, 0.011, 4.5 + i * 0.55)
        this.group.add(c)
      }
    }
    this.group.add(inlay, outer, inner)
  }

  // ── Walls ──────────────────────────────────────────────────────────────

  private buildWalls(): void {
    const wallMat = this.keep(new THREE.MeshStandardMaterial({ color: 0x0d1118, roughness: 0.7, metalness: 0.3 }))
    const ribMat = this.keep(new THREE.MeshStandardMaterial({ color: 0x161b25, roughness: 0.5, metalness: 0.6 }))
    const barMat = this.emissive(0xe6efff, 2.2)
    const accentMat = this.emissive(0x19c3ff, 1.8)

    // Side walls (±x) with structural ribs and vertical light bars.
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(D, H)), wallMat)
      wall.position.set(side * W / 2, H / 2, 0)
      wall.rotation.y = -side * Math.PI / 2
      this.group.add(wall)
      for (let z = -D / 2 + 2; z <= D / 2 - 2; z += 3) {
        const rib = new THREE.Mesh(this.keep(new THREE.BoxGeometry(0.35, H, 0.5)), ribMat)
        rib.position.set(side * (W / 2 - 0.2), H / 2, z)
        rib.castShadow = false
        const bar = new THREE.Mesh(this.keep(new THREE.BoxGeometry(0.06, H * 0.55, 0.14)), barMat)
        bar.position.set(side * (W / 2 - 0.4), H * 0.42, z + 1.5)
        this.group.add(rib, bar)
      }
      // Accent line along the base of each wall.
      const line = new THREE.Mesh(this.keep(new THREE.BoxGeometry(0.04, 0.05, D)), accentMat)
      line.position.set(side * (W / 2 - 0.45), 0.6, 0)
      this.group.add(line)
    }
  }

  /** Back wall (−z): LED screen with the game logo, framed by light bars. */
  private buildLedWall(): void {
    const back = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(W, H)), this.keep(new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.8 })))
    back.position.set(0, H / 2, -D / 2)

    const tex = this.keep(ledWallTexture())
    tex.colorSpace = THREE.SRGBColorSpace
    // The wordmark uses the UI font; redraw once it's loaded if it wasn't yet.
    document.fonts
      ?.load('italic 900 210px "Barlow Condensed"')
      .then(() => {
        drawLedWall(tex.image as HTMLCanvasElement)
        tex.needsUpdate = true
      })
      .catch(() => {})
    const screen = new THREE.Mesh(
      this.keep(new THREE.PlaneGeometry(14, 4.4)),
      this.keep(new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.6 })),
    )
    screen.position.set(0, 4.2, -D / 2 + 0.05)

    const frameMat = this.emissive(0xffffff, 2.4)
    for (const y of [1.9, 6.5]) {
      const f = new THREE.Mesh(this.keep(new THREE.BoxGeometry(14.6, 0.06, 0.06)), frameMat)
      f.position.set(0, y, -D / 2 + 0.1)
      this.group.add(f)
    }
    this.group.add(back, screen)
  }

  /** Front wall (+z): big slatted roll-up door with warm light leaking underneath. */
  private buildDoor(): void {
    const front = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(W, H)), this.keep(new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.8 })))
    front.position.set(0, H / 2, D / 2)
    front.rotation.y = Math.PI

    const slatMat = this.keep(new THREE.MeshStandardMaterial({ color: 0x2a303b, roughness: 0.45, metalness: 0.7 }))
    const slatGeo = this.keep(new THREE.BoxGeometry(11, 0.24, 0.08))
    const slats = new THREE.InstancedMesh(slatGeo, slatMat, 22)
    const m = new THREE.Matrix4()
    for (let i = 0; i < 22; i++) {
      m.makeTranslation(0, 0.35 + i * 0.27, D / 2 - 0.1)
      slats.setMatrixAt(i, m)
    }
    const leak = new THREE.Mesh(this.keep(new THREE.BoxGeometry(11, 0.12, 0.05)), this.emissive(0xffb466, 3))
    leak.position.set(0, 0.12, D / 2 - 0.12)
    const warn = new THREE.Mesh(this.keep(new THREE.BoxGeometry(11.6, 0.18, 0.06)), this.emissive(0xffd200, 1.2))
    warn.position.set(0, 6.45, D / 2 - 0.12)
    this.group.add(front, slats, leak, warn)
  }

  // ── Ceiling ────────────────────────────────────────────────────────────

  private buildCeiling(): void {
    const ceiling = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(W, D)), this.keep(new THREE.MeshStandardMaterial({ color: 0x07090d, roughness: 1 })))
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.y = H

    // Steel trusses spanning the room.
    const trussMat = this.keep(new THREE.MeshStandardMaterial({ color: 0x1a1f29, roughness: 0.5, metalness: 0.7 }))
    for (let z = -D / 2 + 3; z < D / 2; z += 4.5) {
      const beam = new THREE.Mesh(this.keep(new THREE.BoxGeometry(W, 0.45, 0.3)), trussMat)
      beam.position.set(0, H - 0.6, z)
      this.group.add(beam)
    }

    // Honeycomb of hexagonal light rings over the car (one draw call).
    const cells: [number, number][] = []
    const dx = Math.sqrt(3) * HEX_R
    const dz = 1.5 * HEX_R
    for (let row = -3; row <= 3; row++) {
      for (let col = -4; col <= 4; col++) {
        const x = col * dx + (row % 2 ? dx / 2 : 0)
        const z = row * dz
        if (Math.hypot(x / 1.3, z) < 5.2) cells.push([x, z])
      }
    }
    const hexes = new THREE.InstancedMesh(this.keep(new THREE.RingGeometry(HEX_R - 0.07, HEX_R - 0.01, 6)), this.emissive(0xffffff, 3.2), cells.length)
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.PI / 6))
    const s = new THREE.Vector3(1, 1, 1)
    const m = new THREE.Matrix4()
    cells.forEach(([x, z], i) => hexes.setMatrixAt(i, m.compose(new THREE.Vector3(x, H - 1.1, z), q, s)))
    this.group.add(ceiling, hexes)
  }

  /** Faint additive light cones under the ceiling lights — sells the haze. */
  private buildBeams(): void {
    const tex = this.keep(beamTexture())
    const mat = this.keep(
      new THREE.MeshBasicMaterial({ color: 0xcfe0ff, alphaMap: tex, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    )
    const geo = this.keep(new THREE.ConeGeometry(1.9, H - 1.2, 40, 1, true))
    for (const [x, z] of [[0, 0], [-7, -6], [7, -6]] as const) {
      const cone = new THREE.Mesh(geo, mat)
      cone.position.set(x, (H - 1.2) / 2, z)
      cone.renderOrder = 10
      this.bakeHidden.push(cone)
      this.group.add(cone)
    }
  }

  // ── Props ──────────────────────────────────────────────────────────────

  private buildProps(): void {
    // Tire stacks (instanced).
    const tireGeo = this.keep(new THREE.TorusGeometry(0.34, 0.13, 12, 28))
    const tireMat = this.keep(new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.85 }))
    const stacks: [number, number, number][] = [[-11.5, -9, 5], [-10.6, -9.4, 4], [11.4, 8.8, 5], [10.5, 9.4, 3], [-11.6, 7.5, 6]]
    const tireCount = stacks.reduce((n, s) => n + s[2], 0)
    const tires = new THREE.InstancedMesh(tireGeo, tireMat, tireCount)
    tires.castShadow = true
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0))
    const one = new THREE.Vector3(1, 1, 1)
    let i = 0
    for (const [x, z, n] of stacks) {
      for (let k = 0; k < n; k++) tires.setMatrixAt(i++, m.compose(new THREE.Vector3(x, 0.14 + k * 0.26, z), q, one))
    }
    this.group.add(tires)

    // Tool chests along the right wall.
    const chestMat = this.keep(new THREE.MeshStandardMaterial({ color: 0xb3121b, roughness: 0.35, metalness: 0.6 }))
    const drawerMat = this.keep(new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.4, metalness: 0.8 }))
    for (const z of [-3.2, -1.6]) {
      const chest = new THREE.Mesh(this.keep(new THREE.BoxGeometry(0.6, 1.1, 1.5)), chestMat)
      chest.position.set(W / 2 - 0.9, 0.55, z)
      chest.castShadow = true
      this.group.add(chest)
      for (let d = 0; d < 5; d++) {
        const handle = new THREE.Mesh(this.keep(new THREE.BoxGeometry(0.02, 0.03, 1.2)), drawerMat)
        handle.position.set(W / 2 - 1.21, 0.2 + d * 0.2, z)
        this.group.add(handle)
      }
    }

    // Oil drums.
    const drumGeo = this.keep(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 24))
    const drumMats = [0x1f5fd1, 0xffd200, 0x1f5fd1].map((c) => this.keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.5 })))
    ;[[11.6, -8.6], [11.0, -9.3], [11.7, -9.6]].forEach(([x, z], k) => {
      const drum = new THREE.Mesh(drumGeo, drumMats[k])
      drum.position.set(x, 0.45, z)
      drum.castShadow = true
      this.group.add(drum)
    })
  }

  private buildDust(): void {
    const count = 500
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 18
      arr[i * 3 + 1] = Math.random() * (H - 1)
      arr[i * 3 + 2] = (Math.random() - 0.5) * 16
    }
    const geo = this.keep(new THREE.BufferGeometry())
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    const mat = this.keep(new THREE.PointsMaterial({ color: 0xffffff, size: 0.025, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.dust = new THREE.Points(geo, mat)
    this.bakeHidden.push(this.dust)
    this.group.add(this.dust)
  }

  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xc8d8ff, 0x08090c, 0.35)

    const key = new THREE.SpotLight(0xffffff, 520, 24, THREE.MathUtils.degToRad(38), 0.6, 1.5)
    key.position.set(0, H - 1.2, 0.4)
    key.target.position.set(0, 0, 0)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.0005

    // Coloured rim lights pick out the body lines from both sides.
    const rimL = new THREE.PointLight(0x5fb8ff, 70, 16, 1.6)
    rimL.position.set(6, 2.4, -3.5)
    const rimR = new THREE.PointLight(0xffc27a, 55, 16, 1.6)
    rimR.position.set(-6, 2.4, 3.5)
    const floorGlow = new THREE.PointLight(0xffd200, 8, 6, 2)
    floorGlow.position.set(0, 0.3, 4.6)

    this.group.add(hemi, key, key.target, rimL, rimR, floorGlow)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    this.reflector.dispose()
    this.group.removeFromParent()
  }
}

// ── Canvas textures ──────────────────────────────────────────────────────

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}

/** 4×4 m tile of polished concrete: mottled grey with a seam on two edges. */
function concreteTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#4a4f57'
  g.fillRect(0, 0, 512, 512)
  for (let i = 0; i < 2600; i++) {
    const v = 60 + Math.random() * 40
    g.fillStyle = `rgba(${v},${v + 3},${v + 8},${Math.random() * 0.25})`
    const r = Math.random() * 18 + 2
    g.beginPath()
    g.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2)
    g.fill()
  }
  g.fillStyle = 'rgba(10,12,16,0.85)'
  g.fillRect(0, 0, 512, 3)
  g.fillRect(0, 0, 3, 512)
  return new THREE.CanvasTexture(c)
}

/** LED wall: deep gradient, speed stripes and the game wordmark. */
function ledWallTexture(): THREE.CanvasTexture {
  const [c] = canvas(2048, 640)
  drawLedWall(c)
  return new THREE.CanvasTexture(c)
}

function drawLedWall(c: HTMLCanvasElement): void {
  const g = c.getContext('2d')!
  const bg = g.createLinearGradient(0, 0, 2048, 640)
  bg.addColorStop(0, '#05070d')
  bg.addColorStop(0.5, '#0b1a33')
  bg.addColorStop(1, '#05070d')
  g.fillStyle = bg
  g.fillRect(0, 0, 2048, 640)
  // Slanted speed stripes.
  g.save()
  g.transform(1, 0, -0.35, 1, 0, 0)
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 3 === 0 ? 'rgba(255,210,0,0.75)' : 'rgba(25,195,255,0.35)'
    g.fillRect(1250 + i * 52, 0, i % 3 === 0 ? 18 : 8, 640)
  }
  g.restore()
  g.font = 'italic 900 210px "Barlow Condensed", "Arial Narrow", sans-serif'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  g.fillText('RACING', 140, 300)
  const w = g.measureText('RACING').width
  g.fillStyle = '#ffd200'
  g.fillText('/', 140 + w + 20, 300)
  g.fillStyle = '#ffffff'
  g.fillText('GAME', 140 + w + 110, 300)
  g.font = '600 46px "Barlow Condensed", "Arial Narrow", sans-serif'
  g.fillStyle = 'rgba(160,190,255,0.8)'
  g.fillText('PERFORMANCE GARAGE', 150, 470)
  // LED pixel grid.
  g.fillStyle = 'rgba(0,0,0,0.35)'
  for (let x = 0; x < 2048; x += 6) g.fillRect(x, 0, 2, 640)
  for (let y = 0; y < 640; y += 6) g.fillRect(0, y, 2048, 2)
}

/** Vertical alpha ramp for the light cones: bright at the lamp, fading to the floor. */
function beamTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(4, 256)
  const grad = g.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.6, '#555555')
  grad.addColorStop(1, '#000000')
  g.fillStyle = grad
  g.fillRect(0, 0, 4, 256)
  return new THREE.CanvasTexture(c)
}
