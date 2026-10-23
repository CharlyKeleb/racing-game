import { noteLocalSave } from '../stores/accountStore'
/** Scored course events. Finish every gate; no countdown timer ends a run. */
export type DriftEventId = 'flow' | 'sprint' | 'endurance'
export interface DriftEvent {id:DriftEventId;name:string;description:string;laps:number;minSpeed:number;targets:readonly [number,number,number]}
export const DRIFT_EVENTS: Record<DriftEventId,DriftEvent> = {
  flow:{id:'flow',name:'Flow State',description:'Link the hairpins. Chase a clean, flowing lap.',laps:1,minSpeed:30,targets:[2000,5000,9000]},
  sprint:{id:'sprint',name:'Speed Session',description:'Fast entries and big angles. Slides score above 65 km/h.',laps:1,minSpeed:65,targets:[1800,4500,8000]},
  endurance:{id:'endurance',name:'Marathon',description:'Two scored laps. Keep your rhythm all the way to the finish.',laps:2,minSpeed:35,targets:[4000,10000,18000]},
}
export const DRIFT_EVENT=DRIFT_EVENTS.flow
export function driftEvent(id:unknown):DriftEvent {return DRIFT_EVENTS[id==='sprint'||id==='endurance'?id:'flow']}
export function driftMedal(score: number, targets: readonly number[] = DRIFT_EVENT.targets): string {
  return score >= targets[2] ? 'Gold' : score >= targets[1] ? 'Silver' : score >= targets[0] ? 'Bronze' : 'Unranked'
}
export interface DriftRecord { score:number; chain:number }
export function readDriftRecord(track:string,event:DriftEventId='flow'): DriftRecord {
  try {
    const v=JSON.parse(localStorage.getItem(`racing-game:drift:${track}:${event}:course-v1`) ?? '{}')
    return {score:Number.isFinite(v.score) && v.score>0 ? v.score : 0, chain:Number.isFinite(v.chain) && v.chain>0 ? v.chain : 0}
  } catch { return {score:0,chain:0} }
}
export function saveDriftRecord(track:string,record:DriftRecord,event:DriftEventId='flow'): void {
  try { localStorage.setItem(`racing-game:drift:${track}:${event}:course-v1`,JSON.stringify(record)); noteLocalSave() } catch { /* Private browsing: the run still finishes. */ }
}
