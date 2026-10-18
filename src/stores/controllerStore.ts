import { createStore } from 'zustand/vanilla'

/** Browser-standard controller presence, shared by the menu poller and Settings. */
export const controllerStore = createStore<{ connected: boolean }>(() => ({ connected: false }))
