// Test-only ordered TCP delay, bound exclusively to loopback. No Auth or packet inspection.
import net from 'node:net'
const [listenPort = 2571, targetPort = 2570, oneWayMs = 150] = process.argv.slice(2).map(Number)
if (![listenPort, targetPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535)
  || !Number.isInteger(oneWayMs) || oneWayMs < 0 || oneWayMs > 1000 || listenPort === targetPort) {
  throw new Error('Usage: delay-proxy.mjs [listen-port target-port one-way-ms]')
}
const connections = new Set()
const server = net.createServer(client => {
  const upstream = net.connect(targetPort, '127.0.0.1')
  const timers = new Set()
  let queued = 0
  const close = () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear(); client.destroy(); upstream.destroy(); connections.delete(close)
  }
  connections.add(close)
  const later = action => {
    const timer = setTimeout(() => { timers.delete(timer); action() }, oneWayMs)
    timers.add(timer)
  }
  for (const [source, destination] of [[client, upstream], [upstream, client]]) {
    source.on('data', chunk => {
      queued += chunk.length
      if (queued > 1024 * 1024) { close(); return }
      later(() => {
        queued -= chunk.length
        if (!destination.destroyed && !destination.write(chunk)) source.pause()
      })
    })
    destination.on('drain', () => source.resume())
    source.on('end', () => later(() => destination.end()))
    source.on('error', close); source.on('close', close)
  }
})
server.listen(listenPort, '127.0.0.1', () => console.log(`Loopback TCP delay: ${oneWayMs} ms each way, port ${listenPort} -> ${targetPort}`))
const stop = () => { for (const close of connections) close(); server.close() }
process.on('SIGINT', stop); process.on('SIGTERM', stop)
