import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ResultOutbox, RejectedResult, type ResultWriter } from '../server/src/ResultOutbox'
import { isResultRecord } from '../server/src/ResultRecord'
import { savedRace } from './helpers/resultRecord'
const queues: ResultOutbox[] = [], directories: string[] = []
async function directory() { const path = await mkdtemp(join(tmpdir(), 'racing-result-')); directories.push(path); return path }
async function open(path: string, writer: ResultWriter, delay = 10) { const queue = await ResultOutbox.open(path, writer, delay); queues.push(queue); return queue }
afterEach(async () => { for (const q of queues.splice(0)) await q.close(); for (const d of directories.splice(0)) await rm(d, { recursive: true, force: true }) })
const receipt = (id: string) => ({ raceId: id, savedAt: '2026-10-23T17:00:00Z' })
it('retains the exact record on disk during an outage, retries, and acknowledges only a matching DB commit', async () => {
  const path = await directory(), record = savedRace(), notify = vi.fn()
  let available = false
  const writer = vi.fn(async () => { if (!available) throw new Error('outage'); return receipt(record.result.raceId) })
  const queue = await open(path, writer)
  await queue.enqueue(record, notify)
  expect(notify).toHaveBeenCalledWith({ raceId: record.result.raceId, state: 'pending' })
  expect(JSON.parse(await readFile(join(path, `${record.result.raceId}.json`), 'utf8'))).toEqual(record)
  await vi.waitFor(() => expect(writer).toHaveBeenCalled())
  expect(notify.mock.calls.some(([s]) => s.state === 'saved')).toBe(false)
  available = true
  await vi.waitFor(() => expect(notify).toHaveBeenCalledWith({ ...receipt(record.result.raceId), state: 'saved' }))
  await vi.waitFor(async () => expect(await readdir(path)).toEqual([]))
})
it('replays after restart and permits same-result retries without duplicate queued records', async () => {
  const path = await directory(), record = savedRace(), notify = vi.fn()
  const failed = await open(path, async () => { throw new Error('offline') })
  await failed.enqueue(record, notify)
  await failed.enqueue(structuredClone(record), notify)
  expect(await readdir(path)).toEqual([`${record.result.raceId}.json`])
  const conflict = structuredClone(record); conflict.fingerprint = 'b'.repeat(64)
  await expect(failed.enqueue(conflict, notify)).rejects.toBeInstanceOf(RejectedResult)
  await failed.close()
  const writer = vi.fn(async () => receipt(record.result.raceId))
  await open(path, writer)
  await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(record))
  await vi.waitFor(async () => expect(await readdir(path)).toEqual([]))
})
it('recovers a fully written pre-rename record and blocks startup on a partial/corrupt file', async () => {
  const path = await directory(), record = savedRace()
  await writeFile(join(path, 'a.tmp'), JSON.stringify(record))
  const writer = vi.fn(async () => receipt(record.result.raceId))
  const queue = await open(path, writer)
  await vi.waitFor(() => expect(writer).toHaveBeenCalledWith(record))
  await queue.close()
  await writeFile(join(path, 'b.tmp'), '{broken')
  await expect(ResultOutbox.open(path, writer)).rejects.toThrow()
  await rm(join(path, 'b.tmp'))
})
it('quarantines permanent DB rejection, bounds retained records, and never falsely reports saved', async () => {
  const path = await directory(), record = savedRace(), notify = vi.fn()
  const queue = await open(path, async () => { throw new RejectedResult('conflict') })
  await queue.enqueue(record, notify)
  await vi.waitFor(() => expect(notify).toHaveBeenCalledWith({ raceId: record.result.raceId, state: 'failed' }))
  expect(await readdir(path)).toEqual([`${record.result.raceId}.rejected`])
  expect(notify.mock.calls.some(([s]) => s.state === 'saved')).toBe(false)
  await queue.close()
  for (let i = 0; i < 99; i++) await writeFile(join(path, `${String(i).padStart(8, '0')}.rejected`), '{}')
  const full = await open(path, async r => receipt(r.result.raceId))
  await expect(full.enqueue(savedRace('20000000-0000-4000-8000-000000000002'), notify)).rejects.toThrow('full')
})
it('does not accept foreign, malformed or unapproved result records or a mismatched DB receipt', async () => {
  const path = await directory(), record = savedRace(), notify = vi.fn()
  const queue = await open(path, async () => receipt('wrong-race'))
  const bad = structuredClone(record); bad.result.racers[1].finishTicks = 1
  expect(isResultRecord(bad)).toBe(false)
  const malformed = savedRace(); malformed.result.racers[1] = null as never
  expect(isResultRecord(malformed)).toBe(false)
  await expect(queue.enqueue(bad, notify)).rejects.toThrow()
  await queue.enqueue(record, notify)
  await new Promise(resolve => setTimeout(resolve, 40))
  expect(notify.mock.calls.some(([s]) => s.state === 'saved')).toBe(false)
  expect(await readdir(path)).toEqual([`${record.result.raceId}.json`])
})
it('survives a room callback throwing and preserves the result until shutdown completes', async () => {
  const path = await directory(), record = savedRace()
  const queue = await open(path, async r => receipt(r.result.raceId))
  await queue.enqueue(record, () => { throw new Error('room closed') })
  await vi.waitFor(async () => expect(await readdir(path)).toEqual([]))
})
