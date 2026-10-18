import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import type { AssetManager } from '../engine/AssetManager'
import type { QualityPreset } from '../stores/gameStore'

/**
 * The garage behind the menu and garage screens: the NFS 2015 workshop
 * (public/models/garage, built by scripts/garage/build-garage.mjs).
 *
 * Its lighting is baked into the textures, so the room is drawn unlit — no
 * lights, no shadow passes, cheap on phones. The car is the only lit thing:
 * a PMREM environment baked from the room itself (so the paint reflects this
 * exact garage), a neutral fill with a low overhead key, two faint rims, a soft contact
 * shadow and — on Medium/High — a faint polished-floor reflection.
 *
 * While active, the track, sky and sun are hidden, and the scene's fog,
 * background and reflection map are swapped for the garage's own.
 */

const BACKGROUND = new THREE.Color(0x06070a)
const MANIFEST_URL = '/models/garage/garage.json'
/** Keep the camera this far off walls and pillars. */
const WALL_MARGIN = 0.6
/** Floor sheen: reflection radius around the car, m. */
const SHEEN_RADIUS = 9

interface ReflectorShaderDef {
  name: string
  uniforms: Record<string, THREE.IUniform>
  vertexShader: string
  fragmentShader: string
}

interface GarageManifest {
  models: { high: string; low: string }
  /** Distance to the nearest wall at camera height in 32 directions; k → (sin a, cos a), a = k/32·2π. */
  clearance: number[]
  ceiling: number
  /** Resting camera yaw (car frame; Game's showroomYaw starts here) and the half-width of the open arc around it, radians. */
  heroYaw: number
  heroArc: number
}

export class Showroom {
  readonly group = new THREE.Group()
  private readonly renderer: THREE.WebGLRenderer
  private readonly disposables: { dispose(): void }[] = []
  /** Excluded from the environment bake (mirror, particles, the car's own shadow). */
  private readonly bakeHidden: THREE.Object3D[] = []
  private reflector: Reflector | null = null
  private dust!: THREE.Points
  private envMap: THREE.Texture | null = null
  private manifest: GarageManifest | null = null
  /** The loaded room model, which detail it is, and what it owns (freed when swapped). */
  private room: THREE.Object3D | null = null
  private roomTier: 'low' | 'high' | null = null
  private roomDisposables: { dispose(): void }[] = []
  private wantsHigh = false
  private saved: { fog: THREE.Scene['fog']; background: THREE.Scene['background']; environment: THREE.Texture | null; intensity: number } | null = null
  private active = false
  private time = 0
  /** Scene the showroom was last activated in, to hot-swap reflections when the room loads. */
  private sceneRef: THREE.Scene | null = null
  private fallbackFloor!: THREE.Mesh
  private key!: THREE.SpotLight
  private readonly tyreBlobs: THREE.Mesh[] = []
  private blobGeo!: THREE.PlaneGeometry
  private blobMat!: THREE.MeshBasicMaterial

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.group.name = 'Showroom'
    this.group.visible = false
    this.buildFallbackFloor()
    this.buildContactShadow()
    this.buildDust()
    this.buildLights()
  }

  /**
   * Streams in the garage model for this quality tier. Safe to skip or fail:
   * the showroom then shows a dark floor with the car lit as normal.
   */
  /**
   * Bring up the garage for the menu with the light (1.1 MB) model; on High and
   * Medium, `upgrade()` later swaps in the sharp-textured one (3 MB, same
   * geometry), so first boot doesn't wait for it.
   */
  async load(assets: AssetManager, quality: QualityPreset): Promise<void> {
    this.wantsHigh = quality !== 'low'
    try {
      const manifest = await assets.loadJson<GarageManifest>(MANIFEST_URL)
      if (!manifest) return
      this.manifest = manifest
      await this.loadRoom(assets, 'low')
      this.fallbackFloor.visible = false
      if (this.wantsHigh) {
        this.buildFloorSheen()
        this.buildShadowCatcher()
      }
    } catch (err) {
      console.warn('[Showroom] garage model unavailable, using a plain floor', err)
    }
  }

  /** Swap in the high-detail room (High / Medium presets). Safe to call any time after load. */
  async upgrade(assets: AssetManager): Promise<void> {
    if (!this.wantsHigh || !this.manifest || this.roomTier === 'high') return
    try {
      await this.loadRoom(assets, 'high')
    } catch (err) {
      console.warn('[Showroom] high-detail garage unavailable, keeping the light one', err)
    }
  }

  private async loadRoom(assets: AssetManager, tier: 'low' | 'high'): Promise<void> {
    const base = MANIFEST_URL.slice(0, MANIFEST_URL.lastIndexOf('/') + 1)
    const gltf = await assets.loadGltf(base + this.manifest!.models[tier])
    const room = gltf.scene
    const owned: { dispose(): void }[] = []
    room.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.fog = false
      if (mat.userData.glow) {
        // Bulb and tube glows on black: add light, never darken or occlude.
        mat.blending = THREE.AdditiveBlending
        mat.transparent = true
        mat.depthWrite = false
        mesh.renderOrder = 5
      }
      owned.push(mesh.geometry, mat)
      if (mat.map) owned.push(mat.map)
      o.matrixAutoUpdate = false
      o.updateMatrix()
    })
    // Replace the previous room, if any, and free it.
    if (this.room) {
      this.room.removeFromParent()
      for (const d of this.roomDisposables) d.dispose()
    }
    this.room = room
    this.roomTier = tier
    this.roomDisposables = owned
    this.group.add(room)
    // Re-bake reflections from the room now in place.
    if (this.envMap) {
      this.envMap = this.bakeEnvironment()
      if (this.active && this.sceneRef) this.sceneRef.environment = this.envMap
    }
  }


  /** Centers the room on the car's spot, facing `heading` (yaw, radians). */
  placeAt(position: THREE.Vector3, heading: number): void {
    this.group.position.set(position.x, this.group.position.y, position.z)
    this.group.rotation.y = heading
  }

  /**
   * Seats the garage floor at the height the car's tyres actually rest on.
   * The car stands on a flat physics pad (see Game.updateShowroom) a few
   * centimetres above the track, so the room has to come up to meet it.
   */
  setFloorHeight(y: number): void {
    this.group.position.y = y
  }

  /** Dark contact patches under each tyre: the strongest "it's touching the floor" cue. */
  setCarFootprint(wheels: { position: [number, number, number]; width: number; radius: number }[]): void {
    for (const blob of this.tyreBlobs) {
      blob.removeFromParent()
    }
    this.tyreBlobs.length = 0
    for (const w of wheels) {
      const blob = new THREE.Mesh(this.blobGeo, this.blobMat)
      blob.scale.set(w.width * 1.5, 1, w.radius * 1.9)
      blob.position.set(w.position[0], 0.012, w.position[2])
      blob.renderOrder = 3
      this.bakeHidden.push(blob)
      this.tyreBlobs.push(blob)
      this.group.add(blob)
    }
  }

  /**
   * How far the camera may sit from the car in direction `yaw` (car-local,
   * the ChaseCamera.showroom convention) before it would pass through a wall.
   */
  cameraClearance(yaw: number): number {
    const c = this.manifest?.clearance
    if (!c) return Infinity
    const n = c.length
    const f = ((((yaw / (Math.PI * 2)) % 1) + 1) % 1) * n
    const i = Math.floor(f)
    const t = f - i
    const d = c[i % n] * (1 - t) + c[(i + 1) % n] * t
    // Neighbours too: a pillar between two samples shouldn't sneak through.
    return Math.min(d, c[(i + n - 1) % n] + 0.8, c[(i + 2) % n] + 0.8) - WALL_MARGIN
  }

  setActive(scene: THREE.Scene, active: boolean, hide: THREE.Object3D[]): void {
    if (active === this.active) return
    this.active = active
    this.sceneRef = scene
    for (const o of hide) o.visible = !active
    if (active) {
      this.envMap ??= this.bakeEnvironment()
      this.saved = { fog: scene.fog, background: scene.background, environment: scene.environment, intensity: scene.environmentIntensity }
      // A faint haze on the car and dust only; the room itself ignores fog.
      scene.fog = new THREE.FogExp2(0x0b0c10, 0.012)
      scene.background = BACKGROUND
      scene.environment = this.envMap
      // The bake holds the room's bright lamps and tubes; at full strength
      // their reflection washed the paint out (Guards Red read pink-orange).
      scene.environmentIntensity = 0.5
      this.group.visible = true
    } else if (this.saved) {
      scene.fog = this.saved.fog
      scene.background = this.saved.background
      scene.environment = this.saved.environment
      scene.environmentIntensity = this.saved.intensity
      this.group.visible = false
    }
  }

  /** Per-frame ambience (dust drifting through the light). Only runs while visible. */
  update(dt: number): void {
    if (!this.active) return
    this.time += dt
    const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute
    const arr = pos.array as Float32Array
    const top = (this.manifest?.ceiling ?? 5) - 0.5
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += dt * (0.04 + (i % 7) * 0.006)
      arr[i] += Math.sin(this.time * 0.3 + i) * dt * 0.03
      if (arr[i + 1] > top) arr[i + 1] = 0.2
    }
    pos.needsUpdate = true
  }

  /**
   * Renders the room into a cube map from just above the car, so paint and
   * glass reflect this garage's own lamps, walls and workshop bay.
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
    const target = pmrem.fromScene(bakeScene, 0.02, 0.1, 80, { size: 256, position: new THREE.Vector3(0, 1.1, 0) })
    pmrem.dispose()
    this.disposables.push(target)

    for (const o of this.bakeHidden) o.visible = true
    this.group.position.copy(savedPos)
    this.group.rotation.y = savedRotY
    this.group.visible = visible
    parent?.add(this.group)
    return target.texture
  }

  // ── Floor ──────────────────────────────────────────────────────────────

  /** Shown until (or if never) the garage model loads. */
  private buildFallbackFloor(): void {
    const geo = new THREE.CircleGeometry(30, 48)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ color: 0x14161b, fog: false })
    this.disposables.push(geo, mat)
    this.fallbackFloor = new THREE.Mesh(geo, mat)
    this.group.add(this.fallbackFloor)
  }

  /**
   * The room is unlit, so it can't receive shadows itself. An invisible floor
   * plane that renders only the shadow (ShadowMaterial) lays the car's real
   * shadow from the overhead key light onto the baked concrete.
   */
  private buildShadowCatcher(): void {
    const geo = new THREE.PlaneGeometry(14, 14)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.ShadowMaterial({ opacity: 0.55, color: 0x050302 })
    this.disposables.push(geo, mat)
    const catcher = new THREE.Mesh(geo, mat)
    catcher.position.y = 0.004
    catcher.receiveShadow = true
    catcher.renderOrder = 2
    this.bakeHidden.push(catcher)
    this.group.add(catcher)
    this.key.castShadow = true
  }

  /** Soft dark ellipse under the car (ambient occlusion): grounds it on every tier. */
  private buildContactShadow(): void {
    const [c, g] = canvas(256, 256)
    const grad = g.createRadialGradient(128, 128, 10, 128, 128, 128)
    grad.addColorStop(0, 'rgba(0,0,0,0.97)')
    grad.addColorStop(0.62, 'rgba(0,0,0,0.82)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(c)
    const geo = new THREE.PlaneGeometry(2.6, 5.4)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 })
    this.disposables.push(tex, geo, mat)
    const shadow = new THREE.Mesh(geo, mat)
    shadow.position.y = 0.01
    shadow.renderOrder = 2
    this.bakeHidden.push(shadow)
    this.group.add(shadow)

    // Tyre contact blob texture, shared by the four patches (see setCarFootprint).
    const [bc, bg] = canvas(64, 64)
    const bgrad = bg.createRadialGradient(32, 32, 2, 32, 32, 32)
    bgrad.addColorStop(0, 'rgba(0,0,0,0.9)')
    bgrad.addColorStop(0.6, 'rgba(0,0,0,0.5)')
    bgrad.addColorStop(1, 'rgba(0,0,0,0)')
    bg.fillStyle = bgrad
    bg.fillRect(0, 0, 64, 64)
    const btex = new THREE.CanvasTexture(bc)
    this.blobGeo = new THREE.PlaneGeometry(1, 1)
    this.blobGeo.rotateX(-Math.PI / 2)
    this.blobMat = new THREE.MeshBasicMaterial({ map: btex, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -3 })
    this.disposables.push(btex, this.blobGeo, this.blobMat)
    this.buildLightPool()
  }

  /** Warm pool of lamp light on the floor around the car, like a lit bay. Additive, so it only brightens. */
  private buildLightPool(): void {
    const [c, g] = canvas(256, 256)
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    grad.addColorStop(0, 'rgba(255,214,160,0.55)')
    grad.addColorStop(0.45, 'rgba(255,200,140,0.22)')
    grad.addColorStop(1, 'rgba(255,190,120,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const geo = new THREE.PlaneGeometry(9, 11)
    geo.rotateX(-Math.PI / 2)
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
    this.disposables.push(tex, geo, mat)
    const pool = new THREE.Mesh(geo, mat)
    pool.position.y = 0.008
    pool.renderOrder = 1
    this.group.add(pool)
  }

  /**
   * Polished-concrete sheen: a mirror of the room, added faintly on top of the
   * floor texture and faded out radially so there's no visible edge.
   * Medium/High only — it renders the scene a second time.
   */
  private buildFloorSheen(): void {
    const base = (Reflector as unknown as { ReflectorShader: ReflectorShaderDef }).ReflectorShader // runtime static, missing from the typings
    const shader = {
      ...base,
      uniforms: THREE.UniformsUtils.clone(base.uniforms),
      vertexShader: base.vertexShader
        .replace('varying vec4 vUv;', 'varying vec4 vUv;\nvarying vec2 vLocal;')
        .replace('vUv = textureMatrix * vec4( position, 1.0 );', 'vUv = textureMatrix * vec4( position, 1.0 );\nvLocal = position.xy;'),
      fragmentShader: base.fragmentShader
        .replace('varying vec4 vUv;', `varying vec4 vUv;\nvarying vec2 vLocal;`)
        .replace(
          'gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );',
          `float fade = 1.0 - smoothstep( ${(SHEEN_RADIUS * 0.35).toFixed(2)}, ${SHEEN_RADIUS.toFixed(2)}, length( vLocal ) );
			gl_FragColor = vec4( base.rgb * color * fade, 1.0 );`,
        ),
    }
    const dpr = Math.min(window.devicePixelRatio, 2)
    const geo = new THREE.CircleGeometry(SHEEN_RADIUS, 48)
    this.disposables.push(geo)
    const reflector = new Reflector(geo, {
      textureWidth: Math.round(window.innerWidth * dpr * 0.4),
      textureHeight: Math.round(window.innerHeight * dpr * 0.4),
      color: 0x3a3a3a,
      clipBias: 0.003,
      shader,
    })
    const mat = reflector.material as THREE.ShaderMaterial
    mat.transparent = true
    mat.blending = THREE.AdditiveBlending
    mat.depthWrite = false
    reflector.rotation.x = -Math.PI / 2
    reflector.position.y = 0.006
    reflector.renderOrder = 1
    this.bakeHidden.push(reflector)
    this.reflector = reflector
    this.group.add(reflector)
  }

  private buildDust(): void {
    const count = 420
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 14
      arr[i * 3 + 1] = Math.random() * 5
      arr[i * 3 + 2] = (Math.random() - 0.5) * 14
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    const mat = new THREE.PointsMaterial({ color: 0xfff1d6, size: 0.022, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
    this.disposables.push(geo, mat)
    this.dust = new THREE.Points(geo, mat)
    this.bakeHidden.push(this.dust)
    this.group.add(this.dust)
  }

  /**
   * Car lights only (the room is unlit). The paint should show its true
   * colour, so the car is lit mostly by an even, neutral white fill. The
   * overhead spot is kept low and white, mainly to cast the floor shadow: at
   * full strength (a warm 330) it blew a hot spot over the roof and bonnet
   * and tinted every colour. Two faint rims still pick out the body lines
   * against the dark corners.
   */
  private buildLights(): void {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a2a, 2.2)

    const key = new THREE.SpotLight(0xffffff, 60, 18, THREE.MathUtils.degToRad(42), 0.8, 1.5)
    key.position.set(0.6, 4.4, 0.9)
    key.target.position.set(0, 0, 0)
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    key.shadow.radius = 6
    key.shadow.camera.near = 1
    key.shadow.camera.far = 10
    this.key = key

    const rimCool = new THREE.PointLight(0x9cc8ff, 16, 14, 1.6)
    rimCool.position.set(-4.5, 2.2, -4)
    const rimWarm = new THREE.PointLight(0xffc489, 14, 14, 1.6)
    rimWarm.position.set(5, 2.0, 3.5)

    this.group.add(hemi, key, key.target, rimCool, rimWarm)
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose()
    for (const d of this.roomDisposables) d.dispose()
    this.reflector?.dispose()
    this.group.removeFromParent()
  }
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!]
}
