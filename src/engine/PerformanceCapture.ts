/** Opt-in, bounded diagnostics. No observers/listeners or per-frame work without ?perf=1. */
export const CAPTURE_LIMIT = 18000
export function summarize(values: number[]) {
  const sorted = values.slice().sort((a, b) => a - b)
  const percentile = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : null
  return { count: sorted.length, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99),
    over33: values.filter(v => v > 33).length, over50: values.filter(v => v > 50).length,
    over100: values.filter(v => v > 100).length }
}

class PerformanceCapture {
  active = false
  private frames: number[][] = []
  private events: { at: number; kind: string; duration: number; detail?: unknown }[] = []
  private started = 0
  private ended: number | null = null
  private dropped = 0
  private inputAt: number | null = null
  private observer?: PerformanceObserver
  private context: () => unknown = () => null

  constructor() {
    if (typeof window === 'undefined' || new URLSearchParams(location.search).get('perf') !== '1') return
    Object.assign(window, { __racePerf: {
      start: () => this.start(), stop: () => this.stop(), report: () => this.report(),
      download: () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(this.report(), null, 2)], { type: 'application/json' }))
        const link = document.createElement('a'); link.href = url; link.download = 'race-performance.json'; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      },
    } })
    this.start()
    const mount = () => this.mountControls()
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true })
    else mount()
  }

  private mountControls(): void {
    const panel = document.createElement('details')
    panel.style.cssText = 'position:fixed;top:8px;left:8px;z-index:10000;background:#111;color:#fff;padding:8px;font:12px monospace;max-width:340px'
    const label = document.createElement('summary')
    label.textContent = 'Performance capture'
    panel.append(label)
    const output = document.createElement('textarea')
    output.setAttribute('aria-label', 'Performance capture JSON')
    output.readOnly = true
    output.style.cssText = 'display:block;width:300px;height:80px'
    for (const [text, action] of [
      ['Restart capture', () => { this.start(); output.value = '' }],
      ['Stop and export capture', () => { this.stop(); output.value = JSON.stringify(this.report()) }],
    ] as const) {
      const button = document.createElement('button')
      button.textContent = text
      button.style.cssText = 'display:block;padding:6px;margin:4px;color:white;background:#333'
      button.onclick = action
      panel.append(button)
    }
    panel.append(output)
    document.body.append(panel)
  }

  setContext(context: () => unknown): void { this.context = context }
  private input = (): void => { if (this.inputAt === null) this.inputAt = performance.now() }
  private visibility = (): void => this.event('visibility', 0, document.visibilityState)
  start(): void {
    this.stop()
    this.frames = []; this.events = []; this.dropped = 0; this.inputAt = null
    this.started = performance.now(); this.ended = null; this.active = true
    for (const type of ['keydown', 'pointerdown', 'pointermove', 'touchstart']) window.addEventListener(type, this.input, { passive: true })
    document.addEventListener('visibilitychange', this.visibility)
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      this.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) this.event('longtask', entry.duration, { start: entry.startTime })
      })
      this.observer.observe({ type: 'longtask' })
    }
    this.event('context', 0, this.context())
  }
  stop(): void {
    if (!this.active) return
    this.ended = performance.now(); this.active = false
    this.observer?.disconnect(); this.observer = undefined
    for (const type of ['keydown', 'pointerdown', 'pointermove', 'touchstart']) window.removeEventListener(type, this.input)
    document.removeEventListener('visibilitychange', this.visibility)
  }
  event(kind: string, duration: number, detail?: unknown): void {
    if (!this.active) return
    if (this.events.length < CAPTURE_LIMIT) this.events.push({ at: performance.now() - this.started, kind, duration, detail })
    else this.dropped++
  }
  frame(intervalMs: number, steps: number, simulationMs: number, renderMs: number): void {
    if (!this.active) return
    const now = performance.now()
    if (this.frames.length < CAPTURE_LIMIT) this.frames.push([
      now - this.started, intervalMs, steps, simulationMs, renderMs,
      this.inputAt === null ? -1 : now - this.inputAt, document.hidden ? 1 : 0,
    ])
    else this.dropped++
    this.inputAt = null
  }
  report() {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const visible = this.frames.filter(f => f[6] === 0)
    return {
      schema: 1, startedAt: new Date(performance.timeOrigin + this.started).toISOString(),
      durationMs: (this.ended ?? performance.now()) - this.started, dropped: this.dropped,
      environment: { url: location.origin + location.pathname, userAgent: navigator.userAgent,
        viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, cores: navigator.hardwareConcurrency },
      context: this.context(),
      summary: { visibleFrames: summarize(visible.map(f => f[1])),
        simulationMs: summarize(visible.map(f => f[3])), renderCpuMs: summarize(visible.map(f => f[4])),
        inputToFrameMs: summarize(visible.filter(f => f[5] >= 0).map(f => f[5])) },
      frameColumns: ['atMs', 'intervalMs', 'fixedSteps', 'simulationMs', 'renderCpuMs', 'inputToFrameMs', 'hidden'],
      frames: this.frames.slice(), events: this.events.slice(),
      resources: resources.map(r => ({ url: r.name.split('?')[0], start: r.startTime, duration: r.duration,
        transferBytes: r.transferSize, encodedBytes: r.encodedBodySize, decodedBytes: r.decodedBodySize })),
      measures: performance.getEntriesByType('measure').map(e => ({ name: e.name, start: e.startTime, duration: e.duration })),
      limitations: ['CPU render time measures submission, not GPU completion; use a browser GPU trace.',
        'Input latency ends at render submission, not presentation; excludes gamepad polling.',
        'GC requires a browser trace. Resource timing may be capped or redacted; retain a HAR.',
        'Record commit, device/GPU, power mode and cache/network conditions in the run manifest.'],
    }
  }
}
export const performanceCapture = new PerformanceCapture()
