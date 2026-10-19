import * as THREE from 'three'
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { TIME_PRESETS, type TimeOfDay, type TimePreset } from './timeOfDay'
import { backend } from '../engine/backend'
import type { AnyRenderer } from '../engine/Renderer'

/** The part of PMREMGenerator used here; the WebGL and WebGPU ones share it. */
interface Pmrem {
  fromScene(scene: THREE.Scene, sigma?: number, near?: number, far?: number): THREE.RenderTarget
  fromEquirectangular(texture: THREE.Texture): THREE.RenderTarget
  dispose(): void
}

/**
 * Sky dome, key light (sun or moon), hemisphere fill, fog and image-based
 * lighting, driven by a time-of-day preset (see timeOfDay.ts).
 *
 * The environment map is an HDR cube baked from the preset's own sky plus a
 * ground hemisphere, through PMREM — so reflections and ambient light always
 * match the visible sun, with no multi-megabyte HDRI download. A preset can
 * still name an equirectangular `.hdr` to use instead.
 *
 * Scene-level state (fog, background, environment) is written by `apply()`, so
 * Game can re-assert it after the garage showroom borrows the scene.
 */
export class Environment {
  readonly group = new THREE.Group()
  /** Shadow-casting key light: the sun by day, the moon at night. */
  readonly sun: THREE.DirectionalLight
  readonly sunDirection = new THREE.Vector3()
  /** WebGL `Sky`, or the node `SkyMesh` under WebGPU. */
  private readonly sky: THREE.Mesh
  /** The sky's uniforms by their WebGL names (both domes expose the same set). */
  private readonly skyUniforms: Record<string, { value: any }> // eslint-disable-line @typescript-eslint/no-explicit-any
  private readonly fog = new THREE.Fog(0xbfd4e6, 250, 900)
  private readonly background = new THREE.Color()
  private readonly fill: THREE.HemisphereLight
  private readonly pmrem: Pmrem
  private envTarget: THREE.RenderTarget | null = null
  private preset: TimePreset = TIME_PRESETS.noon
  private timeOfDay: TimeOfDay | null = null
  private viewFar = 900
  /** Bumped per preset change so a slow HDRI load can't overwrite a newer choice. */
  private generation = 0

  constructor(renderer: AnyRenderer) {
    if (backend.nodes) {
      this.pmrem = new backend.nodes.PMREMGenerator(renderer as never) as unknown as Pmrem
      const dome = backend.nodes.skyDome()
      this.sky = dome.mesh
      this.skyUniforms = dome.uniforms
    } else {
      this.pmrem = new THREE.PMREMGenerator(renderer as THREE.WebGLRenderer) as unknown as Pmrem
      const sky = new Sky()
      const mat = sky.material
      // Exposure + flat tint (overcast grey, night blue) and the radiance clamp:
      // the sun disc reaches ~60000, and without the clamp a wide FOV that
      // catches it floods the screen through bloom (PR #2).
      mat.uniforms.uSkyExposure = { value: 1 }
      mat.uniforms.uSkyTint = { value: new THREE.Vector3() }
      mat.uniforms.uSkyMax = { value: 1.6 }
      mat.fragmentShader = mat.fragmentShader
        .replace('void main() {', 'uniform float uSkyExposure;\nuniform vec3 uSkyTint;\nuniform float uSkyMax;\nvoid main() {')
        .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor * uSkyExposure + uSkyTint, vec3( uSkyMax ) ), 1.0 );')
      this.sky = sky
      this.skyUniforms = mat.uniforms
    }
    this.sky.scale.setScalar(4000)

    this.fill = new THREE.HemisphereLight(0xcfe3ff, 0x4f6a3a, 0.6)

    // Shadow camera follows the player (see follow()) to keep shadows crisp.
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.6)
    this.sun.shadow.mapSize.set(2048, 2048)
    const s = this.sun.shadow.camera
    s.left = s.bottom = -60
    s.right = s.top = 60
    s.near = 1
    s.far = 400
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02

    this.group.add(this.sky, this.fill, this.sun, this.sun.target)
  }

  get current(): TimePreset {
    return this.preset
  }

  /** Switch preset: sky, lights, fog colour, baked environment. Call apply() to push it to the scene. */
  setTimeOfDay(id: TimeOfDay): void {
    if (id === this.timeOfDay) return
    this.timeOfDay = id
    const p = (this.preset = TIME_PRESETS[id])
    const generation = ++this.generation

    const u = this.skyUniforms
    u.turbidity.value = p.sky.turbidity
    u.rayleigh.value = p.sky.rayleigh
    u.mieCoefficient.value = p.sky.mieCoefficient
    u.mieDirectionalG.value = p.sky.mieDirectionalG
    u.sunPosition.value.copy(direction(p.skySun.elevation, p.skySun.azimuth))
    u.uSkyExposure.value = p.skyExposure
    u.uSkyTint.value.set(...p.skyTint)
    u.uSkyMax.value = p.skyMax

    this.sunDirection.copy(direction(p.key.elevation, p.key.azimuth))
    this.sun.color.setHex(p.key.color)
    this.sun.intensity = p.key.intensity
    this.sun.castShadow = p.key.shadows
    this.fill.color.setHex(p.fill.sky)
    this.fill.groundColor.setHex(p.fill.ground)
    this.fill.intensity = p.fill.intensity
    this.fog.color.setHex(p.fog)
    this.fog.near = this.viewFar * p.fogStart
    this.background.setHex(p.fog)

    this.setEnvTarget(this.bakeSky(p))
    if (p.hdri) {
      new HDRLoader()
        .loadAsync(p.hdri)
        .then((tex) => {
          if (generation !== this.generation) return tex.dispose()
          tex.mapping = THREE.EquirectangularReflectionMapping
          this.setEnvTarget(this.pmrem.fromEquirectangular(tex))
          tex.dispose()
        })
        .catch((err: unknown) => console.warn(`[Environment] ${p.hdri} failed, keeping the baked sky`, err))
    }
  }

  /** Write fog, background and image-based lighting onto the scene. */
  apply(scene: THREE.Scene): void {
    scene.fog = this.fog
    scene.background = this.background
    scene.environment = this.envTarget?.texture ?? null
    scene.environmentIntensity = this.preset.envIntensity
  }

  /** Tracks hide their streaming edge in fog; the preset decides where the haze starts. */
  setViewDistance(_near: number, far: number): void {
    this.viewFar = far
    this.fog.near = far * this.preset.fogStart
    this.fog.far = far
  }

  /** Smaller shadow maps on weaker presets (shadows are off entirely on low). */
  setShadowMapSize(size: number): void {
    if (this.sun.shadow.mapSize.x === size) return
    this.sun.shadow.mapSize.set(size, size)
    this.sun.shadow.map?.dispose()
    this.sun.shadow.map = null
  }

  follow(target: THREE.Vector3): void {
    this.sky.position.copy(target)
    this.sun.target.position.copy(target)
    this.sun.position.copy(target).addScaledVector(this.sunDirection, 150)
  }

  /**
   * The preset's sky (same shader, same sun) above a flat ground disc in the
   * preset's ground colour, rendered into a prefiltered HDR cube.
   */
  private bakeSky(p: TimePreset): THREE.RenderTarget {
    const scene = new THREE.Scene()
    const dome = new THREE.Mesh(this.sky.geometry, this.sky.material)
    dome.scale.setScalar(100)
    const groundGeo = new THREE.CircleGeometry(400, 24)
    groundGeo.rotateX(-Math.PI / 2)
    const groundMat = new THREE.MeshBasicMaterial({ color: p.envGround })
    const ground = new THREE.Mesh(groundGeo, groundMat)
    ground.position.y = -1.5
    scene.add(dome, ground)
    const target = this.pmrem.fromScene(scene, 0.02, 0.1, 1000)
    groundGeo.dispose()
    groundMat.dispose()
    return target
  }

  private setEnvTarget(target: THREE.RenderTarget): void {
    const scene = this.group.parent as THREE.Scene | null
    const shown = !!scene && !!this.envTarget && scene.environment === this.envTarget.texture
    this.envTarget?.dispose()
    this.envTarget = target
    // Keep a scene that was showing our environment in sync (an async HDRI lands later).
    if (shown && scene) scene.environment = target.texture
  }

  dispose(): void {
    this.sky.geometry.dispose()
    ;(this.sky.material as THREE.Material).dispose()
    this.sun.shadow.map?.dispose()
    this.envTarget?.dispose()
    this.pmrem.dispose()
    this.group.removeFromParent()
  }
}

/** Unit vector toward a point `elevation` degrees above the horizon at compass `azimuth`. */
function direction(elevation: number, azimuth: number): THREE.Vector3 {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth))
}
