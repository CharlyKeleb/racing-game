import RAPIER from '@dimforge/rapier3d-compat'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { Point3 } from '../racing/TrackProgress'

/**
 * Things to hit on the street maps: lamp posts and traffic cones along the kerbs, and oncoming
 * civilian cars. All of them are real Rapier bodies in the race world, so a car smashes a post
 * over, scatters cones and shunts a car aside; each kind is one InstancedMesh (three draw calls).
 *
 * Posts and cones are fixed until the player's car comes within ARM_RADIUS, then dynamic: left
 * dynamic all along, the ones standing on a kerb edge toppled on their own. They stay where they
 * fall until reset().
 * Traffic is kinematic, so it holds its lane and rides over kerbs instead of catching on them;
 * when the player's car touches one it turns dynamic and gets shunted about, until it's recycled.
 * It drives the far lane toward the player and is recycled ahead of them when it falls far
 * behind (or has sat wrecked a while), so the street never runs empty. Gameplay (traffic control) runs in fixedUpdate, the
 * instance matrices in render().
 */

export interface StreetLifeOptions {
  /** Oncoming civilian cars (Free Roam): off in a race, where they'd ruin it. */
  traffic: boolean
}

interface Prop { body: RAPIER.RigidBody; home: THREE.Vector3; yaw: number; armed: boolean }
interface Civilian {
  body: RAPIER.RigidBody
  collider: RAPIER.Collider
  /** Centreline index it's heading toward (it drives against the race direction). */
  index: number
  /** Seconds since the player hit it (it's a loose dynamic body then); -1 while it drives. */
  wrecked: number
  /** Which car model it wears (an index into carModels) and its instance slot in that model's meshes. */
  model: number
  slot: number
}

/** One traffic car model: a mesh per material, nose toward +Z, wheels on y = 0, about 4.4 m long. */
export type TrafficModel = { geometry: THREE.BufferGeometry; material: THREE.Material }[]

/** Metres from the player's car within which a post or cone turns dynamic, ready to be hit. */
const ARM_RADIUS = 6
const POST_SPACING = 46
const CONE_GROUP_SPACING = 140
const TRAFFIC_COUNT = 8
/** m/s: about 45 km/h. */
const TRAFFIC_SPEED = 12.5
/** How far ahead of the player (along the line, m) a recycled car reappears, and when it's recycled. */
const RESPAWN_AHEAD = [180, 420] as const
const RECYCLE_BEHIND = 160
/** A wrecked car is recycled after this long (s), even if the player is still beside it. */
const WRECK_SECONDS = 8

const _q = new THREE.Quaternion()
const _m = new THREE.Matrix4()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _up = new THREE.Vector3(0, 1, 0)
const _v = { x: 0, y: 0, z: 0 }
const _rot = { x: 0, y: 0, z: 0, w: 1 }
const ZERO = { x: 0, y: 0, z: 0 }

export class StreetLife {
  readonly group = new THREE.Group()
  private readonly posts: Prop[] = []
  private readonly cones: Prop[] = []
  private readonly civilians: Civilian[] = []
  private readonly postMesh: THREE.InstancedMesh
  private readonly coneMesh: THREE.InstancedMesh
  /** Per car model, one InstancedMesh per material; all of a model's meshes share its instance slots. */
  private carModels: THREE.InstancedMesh[][] = []
  private readonly ground: (x: number, y: number, z: number) => number | null
  private disposed = false

  private readonly world: RAPIER.World
  private readonly line: readonly Point3[]

  constructor(
    world: RAPIER.World,
    line: readonly Point3[],
    edges: { left: Float32Array; right: Float32Array },
    ground: (x: number, y: number, z: number) => number | null,
    options: StreetLifeOptions,
  ) {
    this.world = world
    this.line = line
    this.ground = ground
    const n = line.length
    const along = (i: number) => {
      const a = line[(i - 1 + n) % n], b = line[(i + 1) % n]
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1
      return { x: dx / l, z: dz / l }
    }
    // Spacing along the line in metres, not points (spacing varies).
    let run = 0, nextPost = POST_SPACING / 2, nextCones = CONE_GROUP_SPACING / 2, side = 1
    for (let i = 0; i < n; i++) {
      const a = line[i], b = line[(i + 1) % n]
      run += Math.hypot(b.x - a.x, b.z - a.z)
      const t = along(i)
      // Left of travel is (t.z, -t.x) in this +X-left world: the edge widths are measured that way.
      const leftX = t.z, leftZ = -t.x
      if (run >= nextPost) {
        nextPost += POST_SPACING
        for (const s of [1, -1]) {
          const edge = s > 0 ? edges.left[i] : edges.right[i]
          // Narrow or unmeasured streets get none: a post in the lane is a wall, not a prop. Where
          // the paving runs on (a pavement, a plaza), stand it 8.6 m out: a two-lane street's kerb.
          if (!(edge > 4.5)) continue
          const off = Math.min(edge, 8) + 0.6
          this.place(this.posts, a.x + leftX * off * s, a.y, a.z + leftZ * off * s, Math.atan2(t.x, t.z), ground, 'post')
        }
      }
      if (run >= nextCones) {
        nextCones += CONE_GROUP_SPACING
        side = -side
        const edge = side > 0 ? edges.left[i] : edges.right[i]
        if (!(edge > 6)) continue
        // A short taper of cones closing the outer metre or two of the lane, like roadworks.
        for (let k = 0; k < 5; k++) {
          const p = line[(i + k * 2) % n]
          const off = edge - 0.6 - k * 0.35
          this.place(this.cones, p.x + leftX * off * side, p.y, p.z + leftZ * off * side, 0, ground, 'cone')
        }
      }
    }

    this.postMesh = new THREE.InstancedMesh(postGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.4 }), this.posts.length || 1)
    this.coneMesh = new THREE.InstancedMesh(coneGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), this.cones.length || 1)
    this.postMesh.count = this.posts.length
    this.coneMesh.count = this.cones.length
    for (const m of [this.postMesh, this.coneMesh]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; this.group.add(m) }

    if (options.traffic) {
      for (let k = 0; k < TRAFFIC_COUNT; k++) {
        const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -500, 0).setLinearDamping(0.3).setAngularDamping(1))
        const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.7, 2.2).setTranslation(0, 0.75, 0).setMass(1300).setFriction(0.6), body)
        this.civilians.push({ body, collider, index: 0, wrecked: -1, model: 0, slot: k })
      }
      // Box saloons in eight paints until the real models (setTrafficModels) arrive.
      const paints = [0xd8d8d8, 0x1b1d22, 0x8c1c1c, 0x23466e, 0xb8b2a2, 0x3b5a3b, 0x6d6f73, 0xc58b2a]
      const box = new THREE.InstancedMesh(civilianGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.3 }), TRAFFIC_COUNT)
      const color = new THREE.Color()
      for (let k = 0; k < TRAFFIC_COUNT; k++) box.setColorAt(k, color.setHex(paints[k % paints.length]))
      this.carModels = [[box]]
      this.addCarMeshes()
    }
  }

  /** Swaps the placeholder boxes for real car models, dealt round-robin across the traffic. Geometry and materials are borrowed, not owned. */
  setTrafficModels(models: TrafficModel[], shadows = true): void {
    if (this.disposed || !this.civilians.length || !models.length) return
    this.removeCarMeshes(true)
    // Each car's collision box fits its model: the set runs from a 3.1 m city car to a 5.3 m taxi.
    const box = new THREE.Box3(), part = new THREE.Box3()
    const sizes = models.map((parts) => {
      box.makeEmpty()
      for (const p of parts) {
        p.geometry.boundingBox ?? p.geometry.computeBoundingBox()
        box.union(part.copy(p.geometry.boundingBox!))
      }
      return { half: { x: (box.max.x - box.min.x) / 2, y: (box.max.y - box.min.y) / 2, z: (box.max.z - box.min.z) / 2 }, centre: box.getCenter(new THREE.Vector3()) }
    })
    const counts = models.map(() => 0)
    for (let k = 0; k < this.civilians.length; k++) {
      const c = this.civilians[k]
      c.model = k % models.length
      c.slot = counts[c.model]++
      const { half, centre } = sizes[c.model]
      if (!(half.x > 0.3 && half.y > 0.3 && half.z > 0.8)) continue
      c.collider.setHalfExtents(half)
      c.collider.setTranslationWrtParent(centre)
    }
    this.carModels = models.map((parts, i) => parts.map((p) => {
      const mesh = new THREE.InstancedMesh(p.geometry, p.material, counts[i])
      mesh.userData.borrowed = true
      return mesh
    }))
    this.addCarMeshes()
    for (const meshes of this.carModels) for (const m of meshes) m.castShadow = shadows
  }

  private addCarMeshes(): void {
    for (const meshes of this.carModels) for (const m of meshes) {
      m.castShadow = true
      m.frustumCulled = false
      this.group.add(m)
    }
  }

  private removeCarMeshes(release: boolean): void {
    for (const meshes of this.carModels) for (const m of meshes) {
      m.removeFromParent()
      if (release && !m.userData.borrowed) { m.geometry.dispose(); (m.material as THREE.Material).dispose() }
      m.dispose()
    }
    this.carModels = []
  }

  private place(list: Prop[], x: number, y: number, z: number, yaw: number, ground: (x: number, y: number, z: number) => number | null, kind: 'post' | 'cone'): void {
    const g = ground(x, y + 2, z)
    // Off the floor (a drop, a wall top): skip it rather than leave it hanging.
    if (g === null || Math.abs(g - y) > 2) return
    const home = new THREE.Vector3(x, g, z)
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, g + (kind === 'post' ? 3.5 : 0.36), z).setRotation(yawQuat(yaw)).setLinearDamping(0.2).setAngularDamping(0.4)
    const body = this.world.createRigidBody(desc)
    // A post: a 7 m light steel pole that topples when a car hits it. A cone: 4 kg of rubber.
    const shape = kind === 'post' ? RAPIER.ColliderDesc.cylinder(3.5, 0.13).setMass(55).setFriction(0.5).setRestitution(0.1)
      : RAPIER.ColliderDesc.cone(0.36, 0.2).setMass(4).setFriction(0.8).setRestitution(0.2)
    this.world.createCollider(shape, body)
    list.push({ body, home, yaw, armed: false })
  }

  /** Before a race: every post and cone back where it stood, traffic placed ahead of `from` (a line index). */
  reset(from: number): void {
    for (const [list, lift] of [[this.posts, 3.5], [this.cones, 0.36]] as const) for (const p of list) {
      p.body.setBodyType(RAPIER.RigidBodyType.Fixed, false)
      p.body.setTranslation({ x: p.home.x, y: p.home.y + lift, z: p.home.z }, false)
      p.body.setRotation(yawQuat(p.yaw), false)
      p.armed = false
    }
    this.synced = false
    const n = this.line.length
    this.civilians.forEach((c, k) => this.spawnCivilian(c, (from + 30 + Math.round(k * n / Math.max(1, this.civilians.length))) % n))
  }

  /** Arms the props near the player; drives the traffic down the far lane and recycles it. */
  fixedUpdate(dt: number, playerIndex: number, player: RAPIER.Collider): void {
    const pp = player.translation()
    for (const list of [this.posts, this.cones]) for (const p of list) {
      if (p.armed || Math.abs(p.home.x - pp.x) > ARM_RADIUS || Math.abs(p.home.z - pp.z) > ARM_RADIUS) continue
      p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
      p.armed = true
    }
    if (!this.civilians.length) return
    const n = this.line.length
    for (const c of this.civilians) {
      const body = c.body
      // Behind the player (in race direction) by more than RECYCLE_BEHIND m, or wrecked a while: put it ahead again.
      const behind = ((playerIndex - c.index) % n + n) % n
      if ((behind > 0 && behind < n / 2 && behind * 4 > RECYCLE_BEHIND) || c.wrecked > WRECK_SECONDS) {
        const ahead = RESPAWN_AHEAD[0] + Math.random() * (RESPAWN_AHEAD[1] - RESPAWN_AHEAD[0])
        this.spawnCivilian(c, (playerIndex + Math.round(ahead / 4)) % n)
        continue
      }
      if (c.wrecked >= 0) { c.wrecked += dt; continue }
      // The player touched it: let physics have it.
      let hit = false
      this.world.contactPair(c.collider, player, (m) => { if (m.numContacts() > 0) hit = true })
      if (hit) {
        const r = body.rotation(), yaw = 2 * Math.atan2(r.y, r.w)
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
        _v.x = Math.sin(yaw) * TRAFFIC_SPEED; _v.y = 0; _v.z = Math.cos(yaw) * TRAFFIC_SPEED
        body.setLinvel(_v, true)
        c.wrecked = 0
        continue
      }
      const p = body.translation()
      const target = this.lanePoint(c.index)
      if ((target.x - p.x) ** 2 + (target.z - p.z) ** 2 < 36) c.index = (c.index - 1 + n) % n
      const dx = target.x - p.x, dz = target.z - p.z, l = Math.hypot(dx, dz) || 1
      const x = p.x + dx / l * TRAFFIC_SPEED * dt, z = p.z + dz / l * TRAFFIC_SPEED * dt
      const y = this.ground(x, p.y + 1.5, z) ?? target.y
      _v.x = x; _v.y = y; _v.z = z
      body.setNextKinematicTranslation(_v)
      // Face where it's going.
      const yaw = Math.atan2(dx, dz)
      _rot.x = 0; _rot.y = Math.sin(yaw / 2); _rot.z = 0; _rot.w = Math.cos(yaw / 2)
      body.setNextKinematicRotation(_rot)
    }
  }

  /** The far lane at line index i, for a car driving against the race direction. */
  private lanePoint(i: number): { x: number; y: number; z: number } {
    const n = this.line.length
    const a = this.line[(i - 1 + n) % n], b = this.line[(i + 1) % n], p = this.line[i]
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1
    // Driving against the race direction, keep right: that's the race direction's left.
    return { x: p.x + dz / l * 3.2, y: p.y, z: p.z - dx / l * 3.2 }
  }

  private spawnCivilian(c: Civilian, index: number): void {
    const p = this.lanePoint(index)
    c.index = (index - 1 + this.line.length) % this.line.length
    c.wrecked = -1
    c.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
    c.body.setLinvel(ZERO, true)
    c.body.setAngvel(ZERO, true)
    _v.x = p.x; _v.y = this.ground(p.x, p.y + 2, p.z) ?? p.y; _v.z = p.z
    c.body.setTranslation(_v, true)
  }

  /** Copy the bodies into the instance matrices (only what moved). */
  render(): void {
    if (this.disposed) return
    this.sync(this.postMesh, this.posts, 3.5)
    this.sync(this.coneMesh, this.cones, 0.36)
    for (const c of this.civilians) {
      const t = c.body.translation(), r = c.body.rotation()
      _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s)
      for (const m of this.carModels[c.model]) m.setMatrixAt(c.slot, _m)
    }
    for (const meshes of this.carModels) for (const m of meshes) m.instanceMatrix.needsUpdate = true
  }

  private synced = false
  private sync(mesh: THREE.InstancedMesh, list: Prop[], lift: number): void {
    let changed = false
    for (let k = 0; k < list.length; k++) {
      const b = list[k].body
      // Only an armed prop can have moved (and a sleeping one hasn't since).
      if (this.synced && (!list[k].armed || b.isSleeping())) continue
      const t = b.translation(), r = b.rotation()
      // Geometry stands on its base: the body's centre is `lift` above it.
      _q.set(r.x, r.y, r.z, r.w)
      _p.set(0, -lift, 0).applyQuaternion(_q)
      _p.x += t.x; _p.y += t.y; _p.z += t.z
      _m.compose(_p, _q, _s)
      mesh.setMatrixAt(k, _m)
      changed = true
    }
    if (changed) mesh.instanceMatrix.needsUpdate = true
    if (mesh === this.coneMesh) this.synced = true
  }

  dispose(): void {
    this.disposed = true
    for (const p of [...this.posts, ...this.cones]) this.world.removeRigidBody(p.body)
    for (const c of this.civilians) this.world.removeRigidBody(c.body)
    this.group.removeFromParent()
    this.removeCarMeshes(true)
    for (const m of [this.postMesh, this.coneMesh]) {
      m.geometry.dispose()
      ;(m.material as THREE.Material).dispose()
      m.dispose()
    }
  }
}

function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  _q.setFromAxisAngle(_up, yaw)
  return { x: _q.x, y: _q.y, z: _q.z, w: _q.w }
}

/** Merged geometry with a flat vertex colour per part. */
function coloured(parts: [THREE.BufferGeometry, number][]): THREE.BufferGeometry {
  const color = new THREE.Color()
  const list = parts.map(([g, hex]) => {
    const geo = g.index ? g.toNonIndexed() : g
    color.setHex(hex).convertSRGBToLinear()
    const c = new Float32Array(geo.getAttribute('position').count * 3)
    for (let i = 0; i < c.length; i += 3) { c[i] = color.r; c[i + 1] = color.g; c[i + 2] = color.b }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3))
    geo.deleteAttribute('uv')
    return geo
  })
  return mergeGeometries(list)!
}

/** A 7 m street lamp: pole, arm and head, standing on its base at y = 0. */
function postGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.09, 0.13, 7, 8).translate(0, 3.5, 0)
  const arm = new THREE.BoxGeometry(0.08, 0.08, 1.6).translate(0, 6.9, 0.75)
  const head = new THREE.BoxGeometry(0.3, 0.14, 0.6).translate(0, 6.82, 1.5)
  const lamp = new THREE.BoxGeometry(0.24, 0.04, 0.5).translate(0, 6.74, 1.5)
  return coloured([[pole, 0x4a4f55], [arm, 0x4a4f55], [head, 0x2c3035], [lamp, 0xfff1c8]])
}

/** A 72 cm traffic cone with a white band, on its base at y = 0. */
function coneGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.42, 0.04, 0.42).translate(0, 0.02, 0)
  const low = new THREE.CylinderGeometry(0.13, 0.19, 0.3, 12, 1, true).translate(0, 0.19, 0)
  const band = new THREE.CylinderGeometry(0.09, 0.13, 0.16, 12, 1, true).translate(0, 0.42, 0)
  const top = new THREE.CylinderGeometry(0.02, 0.09, 0.22, 12).translate(0, 0.61, 0)
  return coloured([[base, 0x1a1a1a], [low, 0xff5a12], [band, 0xf2f2f2], [top, 0xff5a12]])
}

/** A plain saloon, nose toward +Z, wheels on y = 0. Its paint comes from the instance colour. */
function civilianGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1.8, 0.7, 4.4).translate(0, 0.65, 0)
  const cabin = new THREE.BoxGeometry(1.6, 0.6, 2.2).translate(0, 1.3, -0.25)
  const glass = new THREE.BoxGeometry(1.62, 0.42, 2.0).translate(0, 1.32, -0.25)
  const lights = new THREE.BoxGeometry(1.5, 0.14, 0.04).translate(0, 0.78, 2.21)
  const tail = new THREE.BoxGeometry(1.5, 0.14, 0.04).translate(0, 0.8, -2.21)
  const wheels = [[0.82, 1.35], [-0.82, 1.35], [0.82, -1.35], [-0.82, -1.35]].map(([x, z]) => new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14).rotateZ(Math.PI / 2).translate(x, 0.33, z))
  // White parts take the instance colour (paint); dark parts multiply it near black.
  return coloured([[body, 0xffffff], [cabin, 0xffffff], [glass, 0x1a222c], [lights, 0xfffbe6], [tail, 0xb31010], ...wheels.map((w): [THREE.BufferGeometry, number] => [w, 0x111111])])
}
