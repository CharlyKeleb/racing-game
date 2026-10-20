import {createStore} from 'zustand/vanilla'
import type {ProximityRadar} from '../racing/ProximityRadar'
/** Stable numeric cells + a throttled revision, as with rivalTagStore. */
export const proximityStore=createStore<{radar:ProximityRadar|null;frame:number}>(()=>({radar:null,frame:0}))
