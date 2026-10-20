import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CarModel } from './CarModel'
import { cockpitProfile } from './CockpitConfig'

const point = new THREE.Vector3(), axis = new THREE.Vector3()
/** Compact owned copy: shared GLB geometry, material and cached assets remain untouched. */
function triangles(geometry: THREE.BufferGeometry, selection: number[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry(), index = geometry.getIndex()
  for (const [name, attr] of Object.entries(geometry.attributes)) {
    const data = new Float32Array(selection.length * attr.itemSize)
    for (let i = 0; i < selection.length; i++) {
      const vertex = index ? index.getX(selection[i]) : selection[i]
      for (let c = 0; c < attr.itemSize; c++) data[i * attr.itemSize + c] = attr.getComponent(vertex, c)
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, attr.itemSize))
  }
  out.computeBoundingSphere()
  return out
}

/** Player-only interior presentation. Rivals keep their stock mesh/budget. */
export class CockpitRig {
  readonly steering = new THREE.Group()
  readonly additions = new THREE.Group()
  readonly reusedWheel: boolean
  private readonly profile
  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []
  private readonly replacements: { mesh: THREE.Mesh; original: THREE.BufferGeometry }[] = []
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly displayTexture: THREE.CanvasTexture
  private time = 0
  private lastSpeed = -1
  private lastRpm = -1
  private lastGear = ''

  constructor(model: CarModel) {
    this.profile = cockpitProfile(model.root.name)
    this.steering.name = 'CockpitSteering'; this.additions.name = 'CockpitAdditions'
    this.steering.position.fromArray(this.profile.wheel)
    model.body.updateWorldMatrix(true, true)
    this.reusedWheel = this.extractWheel(model)
    model.body.add(this.steering, this.additions)
    if (!this.reusedWheel) this.buildWheel()
    this.canvas = document.createElement('canvas'); this.canvas.width = 512; this.canvas.height = 128
    this.context = this.canvas.getContext('2d')!
    this.displayTexture = new THREE.CanvasTexture(this.canvas)
    this.displayTexture.colorSpace = THREE.SRGBColorSpace
    this.displayTexture.anisotropy = 2
    const displayMaterial = new THREE.MeshBasicMaterial({ name: 'cockpit_instruments', map: this.displayTexture, toneMapped: false })
    this.materials.push(displayMaterial)
    const display = new THREE.Mesh(this.own(new THREE.PlaneGeometry(...this.profile.displaySize)), displayMaterial)
    display.position.fromArray(this.profile.display); display.rotation.y = Math.PI; display.rotation.x = -.12
    this.additions.add(display)
    const shell = new THREE.MeshStandardMaterial({ name: 'cockpit_cluster_shell', color: '#101820', roughness: .9 })
    this.materials.push(shell)
    const housing = new THREE.Mesh(this.own(new THREE.BoxGeometry(this.profile.displaySize[0]+.018, this.profile.displaySize[1]+.018, .055)), shell)
    housing.position.copy(display.position); housing.position.z += .032
    this.additions.add(housing)
    this.draw(0, 900, 'N', 7500)
  }

  private own<T extends THREE.BufferGeometry>(g: T): T { this.geometries.push(g); return g }

  private extractWheel(model: CarModel): boolean {
    if (this.profile.extraction === 'none') return false
    const plans: { mesh: THREE.Mesh; keep: number[]; turn: number[]; transform: THREE.Matrix4 }[] = []
    const inverse = model.body.matrixWorld.clone().invert(), center = this.profile.wheel
    let count = 0
    model.body.traverse(node => {
      if (!(node instanceof THREE.Mesh) || Array.isArray(node.material)) return
      const material = node.material.name
      if (this.profile.extraction === 'bmw' ? !/audi_r8_lms_steeringwheel/i.test(material) : !/KOP_(Cockpit|InCarbonFiber)/i.test(material)) return
      const transform = new THREE.Matrix4().multiplyMatrices(inverse, node.matrixWorld)
      const positions = node.geometry.getAttribute('position'), index = node.geometry.getIndex(), size = index?.count ?? positions.count
      const keep: number[] = [], turn: number[] = []
      for (let i = 0; i < size; i += 3) {
        let inside = true
        for (let j = 0; j < 3; j++) {
          point.fromBufferAttribute(positions, index ? index.getX(i+j) : i+j).applyMatrix4(transform)
          if (Math.abs(point.x-center[0])>(this.profile.extraction === 'koenigsegg' ? .23 : .19) || Math.abs(point.y-center[1])>.195 || Math.abs(point.z-center[2])>(this.profile.extraction === 'koenigsegg' ? .09 : .115)) inside = false
        }
        const target = inside ? turn : keep; target.push(i, i+1, i+2)
      }
      if (turn.length) { plans.push({ mesh: node, keep, turn, transform }); count += turn.length }
    })
    if (count < 120) return false
    for (const plan of plans) {
      const original = plan.mesh.geometry
      const wheel = this.own(triangles(original, plan.turn).applyMatrix4(plan.transform).translate(-center[0], -center[1], -center[2]))
      this.steering.add(new THREE.Mesh(wheel, plan.mesh.material))
      plan.mesh.geometry = this.own(triangles(original, plan.keep))
      this.replacements.push({ mesh: plan.mesh, original })
    }
    return true
  }

  private buildWheel(): void {
    const dark = new THREE.MeshStandardMaterial({ name: 'cockpit_wheel', color: '#20242a', roughness: .75 })
    this.materials.push(dark)
    const pieces: THREE.BufferGeometry[] = [new THREE.TorusGeometry(.165, .018, 8, 48)]
    for (const angle of [0, Math.PI, Math.PI / 2]) {
      const g = new THREE.BoxGeometry(.22, .025, .024); g.translate(-.07, 0, 0); g.rotateZ(angle); pieces.push(g)
    }
    const hub = new THREE.CylinderGeometry(.045,.045,.035,16); hub.rotateX(Math.PI/2);pieces.push(hub)
    const merged = mergeGeometries(pieces)!; pieces.forEach(g=>g.dispose()); merged.rotateX(this.profile.tilt)
    this.steering.add(new THREE.Mesh(this.own(merged), dark))
  }

  update(steer: number, rpm: number, speedKmh: number, gear: number, redline: number, dt: number): void {
    this.updateSteering(steer, dt)
    this.updateInstruments(rpm, speedKmh, gear, redline, dt)
  }

  updateSteering(steer: number, dt: number): void {
    if (dt <= 0) return
    axis.set(0, -Math.sin(this.profile.tilt), Math.cos(this.profile.tilt))
    this.steering.quaternion.setFromAxisAngle(axis, -THREE.MathUtils.clamp(steer * this.profile.steeringRatio, -Math.PI * 1.3, Math.PI * 1.3))
  }

  updateInstruments(rpm: number, speedKmh: number, gear: number, redline: number, dt: number): void {
    if (dt <= 0) return
    this.time += dt
    if (this.time < .05) return
    this.time %= .05
    const speed = Math.round(Math.abs(speedKmh)), revs = Math.round(rpm), label = gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear)
    if (speed === this.lastSpeed && revs === this.lastRpm && label === this.lastGear) return
    this.lastSpeed = speed; this.lastRpm = revs; this.lastGear = label
    this.draw(speed,revs,label,redline)
  }

  private draw(speed: number, rpm: number, gear: string, redline: number): void {
    const ctx = this.context
    ctx.fillStyle='#080e14';ctx.fillRect(0,0,512,128)
    ctx.strokeStyle='#35424d';ctx.lineWidth=4;ctx.strokeRect(2,2,508,124)
    const fraction=Math.max(0,Math.min(1,rpm/redline))
    for(let i=0;i<24;i++){ctx.fillStyle=i/24<fraction?(i>19?'#ff5747':'#7bd8ec'):'#24313b';ctx.fillRect(12+i*20.4,9,16,10)}
    ctx.textAlign='center';ctx.fillStyle='#f1f7fa';ctx.font='bold 48px sans-serif';ctx.fillText(String(speed),95,79)
    ctx.fillStyle='#ffd044';ctx.fillText(gear,245,79)
    ctx.fillStyle=fraction>.9?'#ff6356':'#e6f1f4';ctx.font='bold 42px monospace';ctx.fillText(String(rpm),405,79)
    ctx.fillStyle='#a9c4cf';ctx.font='20px sans-serif';ctx.fillText('km/h',95,111);ctx.fillText('GEAR',245,111);ctx.fillText(fraction>.9?'RPM / SHIFT':'RPM',405,111)
    this.displayTexture.needsUpdate=true
  }

  dispose(): void {
    for (const r of this.replacements) r.mesh.geometry=r.original
    this.steering.removeFromParent();this.additions.removeFromParent()
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
    this.displayTexture.dispose()
  }
}
