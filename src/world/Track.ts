import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import type { SpawnPoint } from '../vehicles/Vehicle'
import type { Surface } from '../vehicles/Surface'
import type { RaceTrack, ViewDistance } from './RaceTrack'
import { SurfaceMap } from './SurfaceMap'
import type { ProceduralTrackDefinition } from './tracks'

export interface Checkpoint {
  index: number
  position: THREE.Vector3
  /** Direction of travel at this checkpoint. */
  tangent: THREE.Vector3
  /** Half-width of the gate, meters. */
  radius: number
}

const SAMPLES = 600
/** Kerb ribbon width either side of the road, meters (see buildKerbs). */
const KERB_WIDTH = 1.2
const GROUND_SIZE = 1200

/**
 * Builds the drivable world from a TrackDefinition: ground collider, road
 * ribbon, kerbs, scenery and checkpoint gates. The road is flat on y = 0 for
 * now; elevation comes with authored Blender tracks.
 */
export class Track implements RaceTrack {
  readonly group = new THREE.Group()
  readonly killY = -50
  readonly curve: THREE.CatmullRomCurve3
  readonly checkpoints: Checkpoint[]
  readonly line: THREE.Vector3[]
  readonly definition: ProceduralTrackDefinition
  private readonly disposables: { dispose(): void }[] = []
  private readonly surfaces: SurfaceMap

  constructor(def: ProceduralTrackDefinition, world: RAPIER.World) {
    this.definition = def
    this.curve = new THREE.CatmullRomCurve3(
      def.controlPoints.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      true,
      'centripetal',
    )

    // Physics: a single large flat ground. Road and grass share it; grip per
    // surface comes from surfaceAt().
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    world.createCollider(RAPIER.ColliderDesc.cuboid(GROUND_SIZE / 2, 1, GROUND_SIZE / 2).setTranslation(0, -1, 0).setFriction(1), ground)

    this.group.add(this.buildGround(), this.buildRoad(def.roadWidth), this.buildKerbs(def.roadWidth), this.buildScenery(def.roadWidth))
    this.checkpoints = this.buildCheckpoints(def)
    this.line = this.curve.getSpacedPoints(Math.round(this.curve.getLength() / 4)).slice(0, -1)
    this.group.add(this.buildStartLine(def.roadWidth))
    this.surfaces = SurfaceMap.fromRibbon(this.curve.getSpacedPoints(SAMPLES), def.roadWidth / 2, KERB_WIDTH)
  }

  mapOverview() { return this.surfaces.overview() }

  surfaceAt(x: number, z: number): Surface {
    return this.surfaces.at(x, z)
  }

  get name(): string {
    return this.definition.name
  }

  get id(): string {
    return this.definition.id
  }

  respawnAt(index: number): SpawnPoint {
    if (index === 0) return this.spawn
    const cp = this.checkpoints[index] ?? this.checkpoints[0]
    return { position: cp.position.clone().setY(0.6), heading: Math.atan2(cp.tangent.x, cp.tangent.z) }
  }

  update(): void {}

  /** One flat ground collider: it's all road as far as arrows are concerned. */
  isRoadCollider(): boolean {
    return true
  }

  setQuality(): void {}

  viewDistance(): ViewDistance {
    return { fogNear: 250, fogFar: 900 }
  }

  get spawn(): SpawnPoint {
    const p = this.curve.getPointAt(0)
    const t = this.curve.getTangentAt(0)
    // Start a few meters behind the line, slightly above the ground.
    return { position: p.clone().addScaledVector(t, -8).setY(0.6), heading: Math.atan2(t.x, t.z) }
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d)
    return d
  }

  private buildGround(): THREE.Mesh {
    const geo = this.track(new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE))
    geo.rotateX(-Math.PI / 2)
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x4f7a3a, roughness: 1 }))
    const mesh = new THREE.Mesh(geo, mat)
    mesh.receiveShadow = true
    return mesh
  }

  /** Extrudes a flat ribbon along the spline. */
  private ribbon(offsetInner: number, offsetOuter: number, y: number, uvScale: number): THREE.BufferGeometry {
    const positions: number[] = []
    const uvs: number[] = []
    const indices: number[] = []
    const side = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    let dist = 0
    let prev = this.curve.getPointAt(0)
    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES
      const p = this.curve.getPointAt(u % 1)
      const t = this.curve.getTangentAt(u % 1)
      side.crossVectors(up, t).normalize()
      dist += p.distanceTo(prev)
      prev = p
      positions.push(p.x + side.x * offsetInner, y, p.z + side.z * offsetInner)
      positions.push(p.x + side.x * offsetOuter, y, p.z + side.z * offsetOuter)
      uvs.push(0, dist / uvScale, 1, dist / uvScale)
      if (i < SAMPLES) {
        const a = i * 2
        indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return this.track(geo)
  }

  private buildRoad(width: number): THREE.Mesh {
    const tex = this.track(this.asphaltTexture())
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 }))
    mat.name = 'road:asphalt'
    mat.userData.layer = 'road'
    const mesh = new THREE.Mesh(this.ribbon(-width / 2, width / 2, 0.01, width), mat)
    mesh.receiveShadow = true
    return mesh
  }

  private buildKerbs(width: number): THREE.Group {
    const tex = this.track(this.kerbTexture())
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }))
    const g = new THREE.Group()
    g.add(new THREE.Mesh(this.ribbon(width / 2, width / 2 + KERB_WIDTH, 0.015, 4), mat))
    g.add(new THREE.Mesh(this.ribbon(-width / 2 - KERB_WIDTH, -width / 2, 0.015, 4), mat))
    g.children.forEach((m) => (m.receiveShadow = true))
    return g
  }

  /** Instanced trees scattered off-track — mostly there to sell speed. */
  private buildScenery(width: number): THREE.Group {
    const g = new THREE.Group()
    const count = 700
    const trunkGeo = this.track(new THREE.CylinderGeometry(0.25, 0.35, 2.5, 6))
    const leafGeo = this.track(new THREE.ConeGeometry(2.2, 6, 7))
    const trunkMat = this.track(new THREE.MeshStandardMaterial({ color: 0x5b3a21, roughness: 1 }))
    const leafMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2f5d2a, roughness: 1 }))
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count)
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count)
    trunks.castShadow = leaves.castShadow = true

    const samples = this.curve.getSpacedPoints(200)
    const m = new THREE.Matrix4()
    const p = new THREE.Vector3()
    const minDist = width / 2 + 8
    let rng = 1337
    const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647)
    let placed = 0
    for (let tries = 0; placed < count && tries < count * 10; tries++) {
      p.set((rand() - 0.5) * 700, 0, (rand() - 0.5) * 700)
      if (samples.some((s) => s.distanceToSquared(p) < minDist * minDist)) continue
      const s = 0.7 + rand() * 0.8
      m.makeScale(s, s, s).setPosition(p.x, 1.25 * s, p.z)
      trunks.setMatrixAt(placed, m)
      m.makeScale(s, s, s).setPosition(p.x, 5 * s, p.z)
      leaves.setMatrixAt(placed, m)
      placed++
    }
    trunks.count = leaves.count = placed
    g.add(trunks, leaves)
    return g
  }

  private buildCheckpoints(def: ProceduralTrackDefinition): Checkpoint[] {
    return Array.from({ length: def.checkpointCount }, (_, i) => {
      const u = i / def.checkpointCount
      return {
        index: i,
        position: this.curve.getPointAt(u),
        tangent: this.curve.getTangentAt(u),
        radius: def.roadWidth / 2 + 4,
      }
    })
  }

  private buildStartLine(width: number): THREE.Mesh {
    const geo = this.track(new THREE.PlaneGeometry(width, 2))
    geo.rotateX(-Math.PI / 2)
    const mat = this.track(new THREE.MeshStandardMaterial({ map: this.track(this.checkerTexture()), roughness: 0.8 }))
    const mesh = new THREE.Mesh(geo, mat)
    const cp = this.checkpoints[0]
    mesh.position.copy(cp.position).setY(0.02)
    mesh.rotation.y = Math.atan2(cp.tangent.x, cp.tangent.z)
    mesh.receiveShadow = true
    return mesh
  }

  // Procedural canvas textures stand in until authored track textures exist.
  private canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    draw(canvas.getContext('2d')!)
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 8
    return tex
  }

  private asphaltTexture(): THREE.CanvasTexture {
    return this.canvasTexture(256, (ctx) => {
      ctx.fillStyle = '#3a3b3d'
      ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 4000; i++) {
        const v = 40 + Math.random() * 40
        ctx.fillStyle = `rgb(${v},${v},${v + 2})`
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5)
      }
      ctx.fillStyle = '#e8e8e8'
      ctx.fillRect(0, 0, 6, 256)
      ctx.fillRect(250, 0, 6, 256)
      ctx.fillRect(125, 20, 6, 100) // dashed center line
    })
  }

  private kerbTexture(): THREE.CanvasTexture {
    return this.canvasTexture(64, (ctx) => {
      ctx.fillStyle = '#d42020'
      ctx.fillRect(0, 0, 64, 32)
      ctx.fillStyle = '#f2f2f2'
      ctx.fillRect(0, 32, 64, 32)
    })
  }

  private checkerTexture(): THREE.CanvasTexture {
    const tex = this.canvasTexture(128, (ctx) => {
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#111' : '#f5f5f5'
          ctx.fillRect(x * 16, y * 16, 16, 16)
        }
    })
    tex.repeat.set(4, 0.5)
    return tex
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose())
    this.group.removeFromParent()
  }
}
