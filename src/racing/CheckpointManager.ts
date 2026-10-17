import * as THREE from 'three'
import type { Checkpoint } from '../world/Track'

const _d = new THREE.Vector3()

/**
 * Enforces checkpoint order so shortcuts don't count. A checkpoint is passed
 * when the car is within its radius and has crossed its plane going forward.
 * Checkpoint 0 is the start/finish line.
 */
export class CheckpointManager {
  /** Index of the next checkpoint the car must pass. */
  next = 1
  private readonly checkpoints: Checkpoint[]
  private lastSide = new Map<number, number>()

  constructor(checkpoints: Checkpoint[]) {
    this.checkpoints = checkpoints
  }

  /** @returns 'lap' when the start line is crossed after all checkpoints, 'checkpoint' for others. */
  update(position: THREE.Vector3): 'lap' | 'checkpoint' | null {
    const cp = this.checkpoints[this.next]
    _d.subVectors(position, cp.position)
    _d.y = 0
    const side = Math.sign(_d.dot(cp.tangent))
    const prev = this.lastSide.get(cp.index) ?? side
    this.lastSide.set(cp.index, side)

    if (_d.length() > cp.radius) return null
    if (!(prev <= 0 && side > 0)) return null

    const wasFinish = this.next === 0
    this.next = (this.next + 1) % this.checkpoints.length
    this.lastSide.clear()
    return wasFinish ? 'lap' : 'checkpoint'
  }

  /** Progress 0..1 around the lap, for minimaps and AI later. */
  get progress(): number {
    const n = this.checkpoints.length
    return ((this.next - 1 + n) % n) / n
  }

  reset(): void {
    this.next = 1
    this.lastSide.clear()
  }
}
