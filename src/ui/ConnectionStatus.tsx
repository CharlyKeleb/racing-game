import { useStore } from 'zustand'
import { lobbyStore } from '../multiplayer/lobbyStore'

/** No region inference: RTT describes this client’s connection to its room server. */
export function ConnectionStatus() {
  const supported = useStore(lobbyStore, s => s.snapshot?.latencyProbe === true)
  const connected = useStore(lobbyStore, s => s.status === 'connected')
  const sample = useStore(lobbyStore, s => s.connectionLatency)
  if (!supported || !connected) return null
  return <p className="connection-status" title="Round trip to the room server, including scheduling. Variation is the range of up to eight recent samples. This is not input-to-display latency.">
    {sample ? <><strong>{sample.rttMs} ms RTT</strong>{sample.samples > 1 && <span> · {sample.variationMs} ms variation</span>}</> : 'Measuring connection…'}
  </p>
}
