import { performanceCapture } from './PerformanceCapture'

/** Asynchronous, one outstanding query. Never flushes or waits for the GPU. */
export class GpuTimer {
  private extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  private query: WebGLQuery | null = null
  private started = false
  private readonly gl: WebGL2RenderingContext
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2')
  }
  begin(): void {
    const gl = this.gl, ext = this.extension
    if (!ext) return
    if (this.query) {
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        gl.deleteQuery(this.query); this.query = null
      } else if (gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) {
        performanceCapture.event('gpu', gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6)
        gl.deleteQuery(this.query); this.query = null
      }
    }
    if (this.query) return
    this.query = gl.createQuery()
    if (this.query) { gl.beginQuery(ext.TIME_ELAPSED_EXT, this.query); this.started = true }
  }
  end(): void {
    if (this.started) { this.gl.endQuery(this.extension!.TIME_ELAPSED_EXT); this.started = false }
  }
  dispose(): void {
    this.end()
    if (this.query) this.gl.deleteQuery(this.query)
    this.query = null
  }
  get supported(): boolean { return this.extension !== null }
}
