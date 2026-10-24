import { afterEach, beforeEach, expect, it } from 'vitest'
import { vi } from 'vitest'
import { Client, type Room } from '@colyseus/sdk'
import { createBackend } from '../server/src/server'
import { AdmissionError } from '../server/src/auth'
import { RACE_PROTOCOL, type LobbySnapshot, type RaceSnapshot } from '../server/src/protocol'
import type { MetricsReport } from '../server/src/MultiplayerMetrics'
import { scriptedRaceFactory } from './helpers/scriptedRaceFactory'
import { resultPlayers } from './helpers/resultRecord'
let backend: ReturnType<typeof createBackend>, endpoint: string
const clients: Room[] = [], lobbies = new Map<string, LobbySnapshot>(), frames = new Map<string, RaceSnapshot>(), reports: MetricsReport[] = []
beforeEach(async () => {
  backend = createBackend({ origins: ['http://localhost:5173'], maxRooms: 2, raceFactory: scriptedRaceFactory(),
    metrics: { intervalMs: 1000, report: report => { reports.push(report); throw new Error('Synthetic reporter failure') } },
    resultPersistence: { available: true, enqueue: async (record, notify) => {
      for (const state of ['pending','pending','saved','saved'] as const) notify({ raceId: record.result.raceId, state })
    } }, authenticate: async token => {
      if (token === 'bad') throw new AdmissionError(401,'Synthetic rejected token')
      return { id: resultPlayers[token === 'secret-one' ? 0 : 1], handle: `private_${token}`, displayName: `Private ${token}`, expiresAt: Date.now() + 60_000 }
    } })
  await backend.listen(0,'127.0.0.1')
  const address=backend.gameServer.transport.server!.address()
  endpoint=`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})
afterEach(async () => {
  await backend?.shutdown(0)
  clients.length=0; lobbies.clear(); frames.clear(); reports.length=0
})
const admission=(token:string,code?:string)=>fetch(`${endpoint}/rooms`,{method:'POST',headers:{Origin:'http://localhost:5173',Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({protocol:1,action:code?'join':'create',code,carId:'porsche911'})})
function watch(room: Room) {
  clients.push(room); room.reconnection.enabled=false
  room.onMessage('lobby',(s:LobbySnapshot)=>lobbies.set(room.sessionId,s))
  room.onMessage('race',(s:RaceSnapshot)=>frames.set(room.sessionId,s))
  room.onMessage('notice',()=>{});room.onMessage('refreshed',()=>{});room.onMessage('resumed',()=>{})
  return room
}
async function join(token:string,code?:string) {
  const response=await admission(token,code);expect(response.status).toBe(200)
  const room=watch(await new Client(endpoint).consumeSeatReservation(await response.json()))
  room.send('sync');await vi.waitFor(()=>expect(lobbies.has(room.sessionId)).toBe(true));return room
}
const current=(room:Room)=>lobbies.get(room.sessionId)!
it('measures real lifecycle outcomes without identifiers or reporter failures affecting the race', async () => {
  const host=await join('secret-one'),guest=await join('secret-two',current(host).code)
  expect((await admission('bad')).status).toBe(401)
  host.send('laps',3);host.send('ready',true);guest.send('ready',true)
  await vi.waitFor(()=>expect(current(host).racers.every(r=>r.ready)).toBe(true))
  host.send('start');await vi.waitFor(()=>expect(current(host).phase).toBe('loading'))
  const race=current(host).race!,secret=guest.reconnectionToken
  guest.connection.close(4010)
  await vi.waitFor(()=>expect(backend.getMetrics()?.gauges.heldSeats).toBe(1))
  const recovered=watch(await new Client(endpoint).reconnect(secret));recovered.send('refresh','secret-two')
  await vi.waitFor(()=>expect(current(host).racers.every(r=>r.connected)).toBe(true))
  for (const c of [host,recovered])c.send('loaded',{protocol:RACE_PROTOCOL,raceId:race.id,fingerprint:race.fingerprint,simulationVersion:1})
  await vi.waitFor(()=>expect(current(host).phase).toBe('racing'),{timeout:5000})
  const input={raceId:race.id,sequence:0,throttle:1,brake:0,steer:0,handbrake:false,nitro:false}
  host.send('input',input);host.send('input',{...input,position:{x:1e9}})
  await vi.waitFor(()=>expect(current(host).phase).toBe('finished'),{timeout:3000})
  const report=backend.getMetrics()!
  expect(report.events).toMatchObject({admission_ok:2,admission_rejected:1,input_accepted:1,input_rejected:1,
    reconnect_started:1,reconnect_succeeded:1,reconnect_failed:0,race_started:1,race_finished:1,race_aborted:0,result_pending:1,result_saved:1,result_failed:0})
  expect(report.gauges).toMatchObject({rooms:1,racers:2,heldSeats:0,activeRaces:0,pendingResultWrites:0})
  expect(report.histograms.advance_ms.count).toBeGreaterThan(180)
  expect(report.histograms.snapshot_bytes.count).toBeGreaterThanOrEqual(4)
  expect(report.histograms.input_age_ticks.count).toBeGreaterThan(0)
  expect(report.histograms.finalize_ms.count).toBe(1)
  expect(frames.get(host.sessionId)?.result).toEqual(frames.get(recovered.sessionId)?.result)
  expect(reports.length).toBeGreaterThan(0)
  const serialized=JSON.stringify([report,...reports])
  for (const value of [...resultPlayers,'secret-one','secret-two',secret,current(host).code,race.fingerprint,host.sessionId,race.id]) expect(serialized).not.toContain(value)
},10_000)
it('counts rejected and rate-limited admissions using a bounded schema',async()=>{
  const responses=[]
  for(let i=0;i<21;i++)responses.push((await admission('bad')).status)
  expect(responses.filter(status=>status===401)).toHaveLength(20)
  expect(responses.at(-1)).toBe(429)
  expect(backend.getMetrics()?.events).toMatchObject({admission_rejected:20,admission_rate_limited:1,admission_ok:0})
})
it('counts server aborts once without creating a finished result',async()=>{
  const host=await join('secret-one'),guest=await join('secret-two',current(host).code)
  host.send('ready',true);guest.send('ready',true)
  await vi.waitFor(()=>expect(current(host).racers.every(r=>r.ready)).toBe(true))
  host.send('start');await vi.waitFor(()=>expect(current(host).phase).toBe('loading'))
  await backend.shutdown(0)
  expect(backend.getMetrics()?.events).toMatchObject({race_started:1,race_aborted:1,race_finished:0})
  expect(backend.getMetrics()?.gauges).toMatchObject({rooms:0,racers:0})
})
it('does not count transport restoration as recovery success before identity verification',async()=>{
  const host=await join('secret-one'),guest=await join('secret-two',current(host).code)
  const secret=guest.reconnectionToken;guest.connection.close(4010)
  await vi.waitFor(()=>expect(backend.getMetrics()?.events.reconnect_started).toBe(1))
  const restored=watch(await new Client(endpoint).reconnect(secret))
  expect(backend.getMetrics()?.events.reconnect_succeeded).toBe(0)
  restored.send('refresh','secret-one')
  await vi.waitFor(()=>expect(backend.getMetrics()?.events.reconnect_failed).toBe(1))
  expect(backend.getMetrics()?.events.reconnect_succeeded).toBe(0)
})
