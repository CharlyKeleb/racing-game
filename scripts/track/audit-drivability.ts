// Offline drivability audit for every shipped track: the real collision GLB plus the same
// SafetyWalls the game builds, scanned for holes, steps and obstacles in the road, then driven
// on several lines across the road. Reports where a car would launch, fall, flip, hit or stick.
// --crash also fires a settled car at the barriers on both sides at 220 km/h and 40° every ~24 m,
// and reports each one thrown more than 1.5 m up.
// Usage: audit-drivability.ts [trackId ...] [--crash] [--json out.json]
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { MeshoptDecoder } from 'meshoptimizer'
import { Matrix4, Vector3 } from 'three'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import RAPIER from '@dimforge/rapier3d-compat'
import { PhysicsWorld, initRapier } from '../../src/engine/PhysicsWorld'
import { VehiclePhysics } from '../../src/vehicles/VehiclePhysics'
import { resolveVehicleConfig, type VehicleConfig } from '../../src/vehicles/VehicleConfig'
import { addSafetyWalls } from '../../src/world/SafetyWallBody'
import { RecoveryMonitor } from '../../src/racing/RecoveryMonitor'

const root = fileURLToPath(new URL('../../', import.meta.url))
const args = process.argv.slice(2)
const jsonAt = args.indexOf('--json')
const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null
const crashAt = args.indexOf('--crash')
const crashTest = crashAt >= 0 && args.splice(crashAt, 1).length > 0
const tracks = args.length ? args : (await readdir(path.join(root, 'public/models/tracks'))).filter((name) => !name.startsWith('.')).sort()

interface Point { x: number; y: number; z: number }
interface Finding { kind: string; index: number; x: number; z: number; detail: string }

/** Road samples closer than this vertically to the expected surface are normal camber/crown. */
const STEP_LIMIT = 0.12
/** A lateral step inside the paved band this tall is a wall, not a kerb. */
const KERB_LIMIT = 0.25
/** Driving lines as a fraction of the paved half-width on that side. */
const OFFSETS = [0, -0.5, 0.5, -0.8, 0.8]

export async function loadCollision(track: string) {
  const manifest = JSON.parse(await readFile(path.join(root, `public/models/tracks/${track}/track.json`), 'utf8'))
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })
  await MeshoptDecoder.ready
  const document = await io.readBinary(await readFile(path.join(root, `public/models/tracks/${track}/${manifest.collision}`)))
  const meshes: { name: string; vertices: Float32Array; indices: Uint32Array }[] = []
  const point = new Vector3(), matrix = new Matrix4()
  document.getRoot().listScenes()[0].traverse((node) => {
    const mesh = node.getMesh()
    if (!mesh) return
    matrix.fromArray(node.getWorldMatrix())
    for (const primitive of mesh.listPrimitives()) {
      const positions = primitive.getAttribute('POSITION'), index = primitive.getIndices()
      if (!positions || !index) continue
      const vertices = new Float32Array(positions.getCount() * 3)
      for (let i = 0; i < positions.getCount(); i++) {
        point.fromArray(positions.getElement(i, [])).applyMatrix4(matrix)
        vertices[i * 3] = point.x; vertices[i * 3 + 1] = point.y; vertices[i * 3 + 2] = point.z
      }
      meshes.push({ name: node.getName(), vertices, indices: Uint32Array.from(index.getArray()!) })
    }
  })
  return { manifest, meshes }
}

/** The track as the game builds it: collision trimeshes, then SafetyWalls from the floor probe. */
export function buildWorld(meshes: Awaited<ReturnType<typeof loadCollision>>['meshes'], line: Point[], flags?: RAPIER.TriMeshFlags) {
  const physics = new PhysicsWorld()
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  const road = new Set<number>(), barriers = new Set<number>()
  const names = new Map<number, string>()
  for (const mesh of meshes) {
    const barrier = mesh.name.startsWith('barrier')
    const collider = physics.world.createCollider(RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, flags)
      .setFriction(barrier ? 0.25 : 0.9).setRestitution(barrier ? 0.2 : 0), body)
    if (mesh.name.startsWith('road')) road.add(collider.handle)
    if (barrier) barriers.add(collider.handle)
    names.set(collider.handle, mesh.name)
  }
  physics.step(1 / 60)
  const walls = addSafetyWalls(physics.world, line, (c) => barriers.has(c.handle))
  const wallTris = walls ? walls.collider(0).shape.indices.length / 3 : 0
  if (walls) names.set(walls.collider(0).handle, 'safety-walls')
  physics.step(1 / 60)
  // Four triangles (both windings) per wall segment.
  return { physics, road, names, wallSegments: wallTris / 4 }
}

/** Evenly spaced points (m) along the closed centreline, with unit tangents. */
function resample(line: Point[], spacing: number) {
  const out: { p: Point; tx: number; tz: number; index: number }[] = []
  for (let i = 0; i < line.length; i++) {
    const a = line[i], b = line[(i + 1) % line.length]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len < 1e-6) continue
    const tx = (b.x - a.x) / len, tz = (b.z - a.z) / len
    for (let d = 0; d < len; d += spacing) {
      const t = d / len
      out.push({ p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }, tx, tz, index: i })
    }
  }
  return out
}

/**
 * Paved extent (m) either side of a centreline point: where the road collider stops under the line,
 * or sooner where something solid stands across the way (a street circuit's barrier, with the city's
 * pavement carrying on behind it).
 */
function band(world: ReturnType<typeof buildWorld>, p: Point, tx: number, tz: number): [number, number] {
  const onlyRoad = (c: RAPIER.Collider) => world.road.has(c.handle)
  const side = (sign: number) => {
    let last = 0, misses = 0, y = p.y
    for (let o = 0.5; o <= 15; o += 0.5) {
      const x = p.x + tz * o * sign, z = p.z - tx * o * sign, h = world.physics.groundHeight(x, y, z, onlyRoad)
      if (h === null) { if (++misses >= 2) break; continue }
      const wall = world.physics.world.castRay(new RAPIER.Ray({ x: p.x + tz * last * sign, y: y + 0.5, z: p.z - tx * last * sign }, { x: tz * sign, y: 0, z: -tx * sign }),
        o - last, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
      if (wall) break
      last = o; misses = 0; y = h
    }
    return last
  }
  return [side(-1), side(1)]
}

/** Static scan: holes, steps and obstacles inside the paved band (less a 0.75 m kerb margin). */
function scanSurface(world: ReturnType<typeof buildWorld>, line: Point[]): Finding[] {
  const { physics, road } = world
  const onlyRoad = (c: RAPIER.Collider) => road.has(c.handle)
  const findings: Finding[] = []
  const samples = resample(line, 1)
  const lateral = Array.from({ length: 25 }, (_, k) => k - 12)
  const bands = samples.map(({ p, tx, tz }) => band(world, p, tx, tz))
  const inside = (i: number, o: number) => { const [neg, pos] = bands[(i + samples.length) % samples.length]; return o >= -neg + 0.75 && o <= pos - 0.75 }
  // Heights per sample and lane; NaN where that lane is off the paving.
  const grid = samples.map(({ p, tx, tz }, i) => lateral.map((o) => inside(i, o) ? physics.groundHeight(p.x + tz * o, p.y, p.z - tx * o, onlyRoad) ?? NaN : NaN))
  const add = (kind: string, i: number, detail: string, o = 0) => {
    const s = samples[i]
    findings.push({ kind, index: s.index, x: Math.round(s.p.x + s.tz * o), z: Math.round(s.p.z - s.tx * o), detail })
  }
  for (let i = 0; i < samples.length; i++) {
    const { p, tx, tz } = samples[i]
    // Under the centreline there must be a floor (road or not) the car can stand on.
    if (physics.floorHeight(p.x, p.y, p.z) === null) add('hole', i, 'no floor under the centreline')
    for (let k = 0; k < lateral.length; k++) {
      const h = grid[i][k]
      if (!Number.isFinite(h)) continue
      // Along the road: compare with the straight line through the neighbours 2 m either side, so
      // gradients and crests pass and only kinks (a step, a seam, a ramp lip) are reported.
      const a = grid[(i - 2 + samples.length) % samples.length][k], b = grid[(i + 2) % samples.length][k]
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const kink = h - (a + b) / 2
        if (Math.abs(kink) > STEP_LIMIT) add(kink > 0 ? 'bump' : 'dip', i, `${kink > 0 ? '+' : ''}${kink.toFixed(2)} m vs neighbours, ${lateral[k]} m off the line`, lateral[k])
      }
      if (k + 1 < lateral.length && Number.isFinite(grid[i][k + 1]) && Math.abs(grid[i][k + 1] - h) > KERB_LIMIT)
        add('lateral step', i, `${Math.abs(grid[i][k + 1] - h).toFixed(2)} m between ${lateral[k]} and ${lateral[k + 1]} m off the line`, lateral[k])
      // Something solid at bumper or roof height in the paved band: a car runs into it.
      const x = p.x + tz * lateral[k], z = p.z - tx * lateral[k]
      for (const up of [0.45, 1.1]) {
        const ray = new RAPIER.Ray({ x: x - tx, y: h + up, z: z - tz }, { x: tx, y: 0, z: tz })
        if (physics.world.castRay(ray, 2, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)) { add('obstacle', i, `solid ${up} m above the road, ${lateral[k]} m off the line`, lateral[k]); break }
      }
      const ceiling = physics.world.castRay(new RAPIER.Ray({ x, y: h + 0.3, z }, { x: 0, y: 1, z: 0 }), 1.4, true, RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC)
      if (ceiling) add('low ceiling', i, `${(ceiling.timeOfImpact + 0.3).toFixed(2)} m clearance, ${lateral[k]} m off the line`, lateral[k])
    }
  }
  return findings
}

/** Pure pursuit along the centreline at a lateral offset, at a speed the corners allow. */
function drive(world: ReturnType<typeof buildWorld>, line: Point[], config: VehicleConfig, spawn: { position: Point; heading: number }, offset: number, laps: number): Finding[] {
  const { physics } = world
  const findings: Finding[] = []
  const samples = resample(line, 2)
  const n = samples.length
  const bands = samples.map(({ p, tx, tz }) => band(world, p, tx, tz))
  const car = new VehiclePhysics(config, physics.world, { position: { ...spawn.position }, heading: spawn.heading })
  const recovery = new RecoveryMonitor()
  let progress = 0, cursor = 0, air = 0, lastSpeed = 0, reported = new Set<string>()
  const add = (kind: string, detail: string) => {
    const s = samples[cursor % n], key = kind + ':' + Math.floor(s.index / 4)
    if (reported.has(key)) return
    reported.add(key)
    findings.push({ kind, index: s.index, x: Math.round(s.p.x), z: Math.round(s.p.z), detail: `${detail}, driving ${offset === 0 ? 'the centre line' : `${Math.abs(offset * 100)}% to the ${offset < 0 ? 'left' : 'right'}`}` })
  }
  const recover = () => {
    const s = samples[(cursor + 2) % n], y = physics.floorHeight(s.p.x, s.p.y + 1, s.p.z) ?? s.p.y
    car.respawn({ position: { x: s.p.x, y: y + 0.6, z: s.p.z }, heading: Math.atan2(s.tx, s.tz) })
    recovery.reset(); air = 0; lastSpeed = 0
  }
  const maxTicks = Math.ceil(laps * n * 2 / 10 * 60) + 60 * 60
  for (let t = 0; t < maxTicks && progress < laps * n; t++) {
    const b = car.body, p = b.translation(), q = b.rotation(), v = b.linvel()
    // Nearest sample ahead of the cursor.
    let best = cursor, bestD = Infinity
    for (let k = -4; k < 40; k++) {
      const s = samples[((cursor + k) % n + n) % n], d = (s.p.x - p.x) ** 2 + (s.p.z - p.z) ** 2
      if (d < bestD) { bestD = d; best = cursor + k }
    }
    if (best > cursor) { progress += best - cursor; cursor = best }
    const speed = Math.hypot(v.x, v.z)
    const look = samples[(cursor + Math.max(4, Math.round(speed * 0.45))) % n]
    const li = (cursor + Math.max(4, Math.round(speed * 0.45))) % n, o = offset * (offset < 0 ? bands[li][0] : bands[li][1])
    const tx = look.p.x + look.tz * o - p.x, tz = look.p.z - look.tx * o - p.z
    const fx = 2 * (q.x * q.z + q.w * q.y), fz = 1 - 2 * (q.x * q.x + q.y * q.y)
    const err = Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz)
    // Corner speed from the heading change over the next 40 m.
    let turn = 0
    for (let k = 2; k < 20; k++) {
      const s0 = samples[(cursor + k) % n], s1 = samples[(cursor + k + 1) % n]
      turn = Math.max(turn, Math.abs(Math.atan2(s0.tx * s1.tz - s0.tz * s1.tx, s0.tx * s1.tx + s0.tz * s1.tz)) / 2)
    }
    const target = Math.min(70, Math.sqrt(9 / Math.max(turn, 1e-4)))
    const input = { throttle: speed < target ? 1 : 0, brake: speed > target + 3 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 2.2)), handbrake: false, nitro: false }
    car.fixedUpdate(input, 1 / 60)
    physics.step(1 / 60)
    const after = b.translation(), ground = physics.groundHeight(after.x, after.y, after.z)
    const clearance = ground === null ? Infinity : after.y - ground
    air = clearance > 1 ? air + 1 / 60 : 0
    if (air > 0.35) add('launch', `airborne ${clearance === Infinity ? 'with no floor below' : clearance.toFixed(1) + ' m up'}`)
    const nv = b.linvel(), nspeed = Math.hypot(nv.x, nv.z)
    if (lastSpeed - nspeed > 8) add('hard hit', `lost ${((lastSpeed - nspeed) * 3.6).toFixed(0)} km/h in one tick at ${(lastSpeed * 3.6).toFixed(0)} km/h`)
    lastSpeed = nspeed
    const centre = samples[cursor % n].p
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z)
    const reason = recovery.update(1 / 60, { drop: after.y - centre.y, upY, speed: Math.abs(car.controller.forwardSpeed),
      pedal: Math.max(input.throttle, input.brake), offLine: Math.hypot(after.x - centre.x, after.z - centre.z) })
    if (reason) { add(reason === 'stuck' ? 'stuck' : reason === 'fell' ? 'fell' : reason, `recovery: ${reason}`); recover() }
  }
  if (progress < laps * n) findings.push({ kind: 'incomplete', index: samples[cursor % n].index, x: 0, z: 0, detail: `drove ${(progress / n).toFixed(2)} of ${laps} laps, offset ${offset}` })
  physics.world.removeRigidBody(car.body)
  return findings
}

/** Settled, then fired at the barriers either side: a hard hit may stop or spin the car, never throw it up. */
function crash(world: ReturnType<typeof buildWorld>, line: Point[], config: VehicleConfig): Finding[] {
  const { physics } = world
  const findings: Finding[] = [], n = line.length, idle = { throttle: 0, brake: 1, steer: 0, handbrake: false, nitro: false }
  for (let i = 0; i < n; i += 6) {
    const p = line[i], a = line[(i - 1 + n) % n], b = line[(i + 1) % n]
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1, fx = (b.x - a.x) / l, fz = (b.z - a.z) / l
    for (const sign of [1, -1]) {
      const lx = fz * sign, lz = -fx * sign, c = Math.cos(40 * Math.PI / 180), s = Math.sin(40 * Math.PI / 180)
      const hx = fx * c + lx * s, hz = fz * c + lz * s, y = physics.floorHeight(p.x, p.y + 1, p.z) ?? p.y
      const car = new VehiclePhysics(config, physics.world, { position: { x: p.x, y: y + 0.6, z: p.z }, heading: Math.atan2(hx, hz) })
      for (let t = 0; t < 60; t++) { car.fixedUpdate(idle, 1 / 60); physics.step(1 / 60) }
      car.body.setLinvel({ x: hx * 61, y: 0, z: hz * 61 }, true)
      let up = 0
      for (let t = 0; t < 120; t++) {
        car.fixedUpdate({ throttle: 1, brake: 0, steer: 0, handbrake: false, nitro: false }, 1 / 60)
        physics.step(1 / 60)
        const q = car.body.translation(), g = physics.groundHeight(q.x, q.y, q.z)
        if (g !== null) up = Math.max(up, q.y - g)
      }
      if (up > 1.5) findings.push({ kind: 'thrown', index: i, x: Math.round(p.x), z: Math.round(p.z), detail: `${up.toFixed(1)} m up after a 220 km/h, 40° hit on the ${sign > 0 ? 'left' : 'right'}` })
      physics.world.removeRigidBody(car.body)
    }
  }
  return findings
}

await initRapier()
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

async function main() {
const config = resolveVehicleConfig(JSON.parse(await readFile(path.join(root, 'public/models/cars/porsche911/vehicle-config.json'), 'utf8')))
const report: Record<string, { wallSegments: number; surface: Finding[]; driving: Finding[]; crashes?: Finding[] }> = {}
for (const track of tracks) {
  const { manifest, meshes } = await loadCollision(track)
  const line: Point[] = manifest.line.map((p: number[] | Point) => Array.isArray(p) ? { x: p[0], y: p[1], z: p[2] } : p)
  const world = buildWorld(meshes, line)
  const surface = scanSurface(world, line)
  const s = manifest.spawn, spawn = { position: Array.isArray(s.position) ? { x: s.position[0], y: s.position[1], z: s.position[2] } : s.position, heading: s.heading ?? 0 }
  const driving = OFFSETS.flatMap((offset) => drive(world, line, config, spawn, offset, 1))
  const crashes = crashTest ? crash(world, line, config) : undefined
  report[track] = { wallSegments: world.wallSegments, surface, driving, crashes }
  const count = (list: Finding[]) => Object.entries(list.reduce<Record<string, number>>((m, f) => ({ ...m, [f.kind]: (m[f.kind] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'
  console.log(`${track.padEnd(12)} walls ${String(world.wallSegments).padStart(4)} | surface: ${count(surface)} | driving: ${count(driving)}${crashes ? ` | crashes: ${count(crashes)}` : ''}`)
  world.physics.dispose()
}
if (jsonOut) await writeFile(jsonOut, JSON.stringify(report, null, 2))
}
