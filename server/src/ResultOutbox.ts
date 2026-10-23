import { chmod, mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { isResultRecord, type ResultRecord } from './ResultRecord.js'
import type { ResultPersistence } from './protocol.js'

export type ResultWriter = (record: ResultRecord) => Promise<{ raceId: string; savedAt: string }>
export interface ResultPersistenceService {
  readonly available: boolean
  enqueue(record: ResultRecord, notify: (state: ResultPersistence) => void): Promise<void>
}
export class RejectedResult extends Error {}
interface Job {
  record: ResultRecord
  ready: Promise<void>
  durable: boolean
  attempt: number
  at: number
  saved?: { raceId: string; savedAt: string }
  listeners: Set<(state: ResultPersistence) => void>
}
const MAX_RECORD_BYTES = 16_384
const MAX_RECORDS = 100

/** Single-process durable outbox. Never accepts browser submissions. One bounded writer,
 * replay after restart, and exact same-race retries at the database transaction boundary.
 */
export class ResultOutbox implements ResultPersistenceService {
  private readonly jobs = new Map<string, Job>()
  private files = 0
  private timer?: ReturnType<typeof setTimeout>
  private running: Promise<void> | null = null
  private stopped = false

  private constructor(private readonly directory: string, private readonly writer: ResultWriter, private readonly retryBaseMs: number) {}

  static async open(directory: string, writer: ResultWriter, retryBaseMs = 1000): Promise<ResultOutbox> {
    if (!isAbsolute(directory)) throw new Error('Result outbox requires an absolute persistent directory')
    if (!Number.isFinite(retryBaseMs) || retryBaseMs < 1) throw new Error('Invalid result retry delay')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    const queue = new ResultOutbox(directory, writer, retryBaseMs)
    const entries = await readdir(directory, { withFileTypes: true })
    if (entries.length > MAX_RECORDS) throw new Error('Result outbox capacity exceeded; inspect retained records')
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9-]+\.(json|tmp|rejected)$/.test(entry.name)) throw new Error('Unexpected result outbox entry')
      if (entry.name.endsWith('.rejected')) { queue.files++; continue }
      const path = join(directory, entry.name)
      const file = await open(path, 'r')
      let record: unknown
      try {
        if ((await file.stat()).size > MAX_RECORD_BYTES) throw new Error('Oversized result outbox record')
        record = JSON.parse(await file.readFile('utf8'))
      } finally { await file.close() }
      if (!isResultRecord(record)) throw new Error('Invalid result outbox record; inspect before restarting')
      const id = record.result.raceId
      if (entry.name.endsWith('.json') && entry.name !== `${id}.json`) throw new Error('Result outbox identity mismatch')
      const previous = queue.jobs.get(id)
      if (previous && !isDeepStrictEqual(previous.record, record)) throw new Error('Conflicting result outbox records')
      if (entry.name.endsWith('.tmp')) {
        // A crash after fsync but before rename can leave a fully written temporary record.
        const existing = await readFile(queue.path(id), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; return null })
        if (existing && !isDeepStrictEqual(JSON.parse(existing), record)) throw new Error('Conflicting result outbox recovery')
        if (existing) await unlink(path)
        else await rename(path, queue.path(id))
      }
      if (!previous) {
        queue.jobs.set(id, { record, ready: Promise.resolve(), durable: true, at: 0, attempt: 0, listeners: new Set() })
        queue.files++
      }
    }
    await queue.syncDirectory()
    queue.schedule()
    return queue
  }

  get available(): boolean { return !this.stopped && this.files < MAX_RECORDS }

  async enqueue(record: ResultRecord, notify: (state: ResultPersistence) => void): Promise<void> {
    if (this.stopped || !isResultRecord(record)) throw new Error('Cannot enqueue result')
    const id = record.result.raceId
    const previous = this.jobs.get(id)
    if (previous) {
      if (!isDeepStrictEqual(previous.record, record)) throw new RejectedResult('Conflicting result')
      previous.listeners.add(notify)
      await previous.ready
      this.notify(previous, previous.saved ? 'saved' : 'pending', previous.saved?.savedAt)
      return
    }
    if (this.files >= MAX_RECORDS) throw new Error('Result outbox is full')
    const own = structuredClone(record)
    const bytes = JSON.stringify(own)
    if (Buffer.byteLength(bytes) > MAX_RECORD_BYTES) throw new Error('Result record is too large')
    const job: Job = { record: own, ready: Promise.resolve(), durable: false, at: 0, attempt: 0, listeners: new Set([notify]) }
    this.jobs.set(id, job)
    this.files++
    job.ready = this.write(own.result.raceId, bytes).then(() => {
      job.durable = true
      this.notify(job, 'pending')
      this.schedule()
    }).catch(error => {
      this.notify(job, 'failed')
      throw error
    })
    await job.ready
  }

  async close(): Promise<void> {
    this.stopped = true
    clearTimeout(this.timer)
    await Promise.allSettled([...this.jobs.values()].map(job => job.ready))
    await this.running
  }

  private path(id: string) { return join(this.directory, `${id}.json`) }
  private async syncDirectory(): Promise<void> {
    const directory = await open(this.directory, 'r')
    try { await directory.sync() } finally { await directory.close() }
  }
  private async write(id: string, bytes: string): Promise<void> {
    const temporary = join(this.directory, `${randomUUID()}.tmp`)
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(bytes)
      await file.sync()
    } finally { await file.close() }
    await rename(temporary, this.path(id))
    await this.syncDirectory()
  }
  private notify(job: Job, state: ResultPersistence['state'], savedAt?: string): void {
    for (const notify of job.listeners) {
      try { notify({ raceId: job.record.result.raceId, state, ...(savedAt ? { savedAt } : {}) }) } catch { /* A gone room must not stop durable writes. */ }
    }
  }
  private schedule(): void {
    if (this.stopped || this.running) return
    clearTimeout(this.timer)
    let next = Infinity
    for (const job of this.jobs.values()) if (job.durable) next = Math.min(next, job.at)
    if (next === Infinity) return
    this.timer = setTimeout(() => {
      this.running = this.attempt().finally(() => { this.running = null; this.schedule() })
    }, Math.max(0, next - Date.now()))
    this.timer.unref()
  }
  private async attempt(): Promise<void> {
    const job = [...this.jobs.values()].find(job => job.durable && job.at <= Date.now())
    if (!job || this.stopped) return
    const id = job.record.result.raceId
    try {
      const saved = job.saved ?? await this.writer(structuredClone(job.record))
      if (saved.raceId !== id || !Number.isFinite(Date.parse(saved.savedAt))) throw new Error('Invalid persistence acknowledgement')
      job.saved = saved
      this.notify(job, 'saved', saved.savedAt)
      await unlink(this.path(id)).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
      await this.syncDirectory()
      this.files--; this.jobs.delete(id)
    } catch (error) {
      if (error instanceof RejectedResult) {
        try {
          await rename(this.path(id), join(this.directory, `${id}.rejected`))
          await this.syncDirectory()
          this.jobs.delete(id)
          this.notify(job, 'failed')
          return
        } catch { /* Keep retrying if quarantine itself cannot be committed. */ }
      }
      job.at = Date.now() + Math.min(60_000, this.retryBaseMs * 2 ** Math.min(job.attempt++, 16))
    }
  }
}
