import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'

/** Brightest the sky may get. Just over PostFX's bloom threshold (1.2): the sun glints, it doesn't flood. */
const SKY_MAX_LUMINANCE = 1.6

/** Sky dome, sun and fog. Time-of-day presets plug in here later. */
export class Environment {
  readonly group = new THREE.Group()
  readonly sun: THREE.DirectionalLight
  readonly sunDirection = new THREE.Vector3()
  private readonly sky: Sky

  constructor(scene: THREE.Scene) {
    this.sky = new Sky()
    this.sky.scale.setScalar(4000)
    const u = this.sky.material.uniforms
    u.turbidity.value = 6
    u.rayleigh.value = 1.6
    u.mieCoefficient.value = 0.004
    u.mieDirectionalG.value = 0.8
    const elevation = THREE.MathUtils.degToRad(28)
    const azimuth = THREE.MathUtils.degToRad(135)
    this.sunDirection.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth)
    u.sunPosition.value.copy(this.sunDirection)
    // The sky is HDR: the sun disc reaches ~60000 and the glow around it stays
    // well above the bloom threshold, so a wide FOV (speed, nitro kick) that
    // catches the sun washed the whole screen white. Clamp it to a soft glow.
    const sky = this.sky.material
    sky.fragmentShader = sky.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      `gl_FragColor = vec4( min( texColor, vec3( ${SKY_MAX_LUMINANCE.toFixed(2)} ) ), 1.0 );`,
    )

    scene.fog = new THREE.Fog(0xbfd4e6, 250, 900)
    scene.background = new THREE.Color(0xbfd4e6)

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4f6a3a, 0.6)

    // Shadow camera follows the player (see follow()) to keep shadows crisp.
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.6)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const s = this.sun.shadow.camera
    s.left = s.bottom = -60
    s.right = s.top = 60
    s.near = 1
    s.far = 400
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.02

    this.group.add(this.sky, hemi, this.sun, this.sun.target)
  }

  follow(target: THREE.Vector3): void {
    this.sun.target.position.copy(target)
    this.sun.position.copy(target).addScaledVector(this.sunDirection, 150)
  }

  dispose(): void {
    this.sky.geometry.dispose()
    this.sky.material.dispose()
    this.sun.shadow.map?.dispose()
    this.group.removeFromParent()
  }
}
