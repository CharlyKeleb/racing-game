#!/usr/bin/env node
import https from 'node:https'
import http from 'node:http'
import { gunzipSync, brotliDecompressSync, inflateSync } from 'node:zlib'
import { mkdir, writeFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

// Audit real GET responses, including transfer compression; never substitute HEAD.
const useVercel = process.argv.includes('--vercel')
const [originArg, outputArg = '.cache/delivery-audit/latest.json'] = process.argv.slice(2).filter(arg => arg !== '--vercel')
if (!originArg) throw new Error('Usage: node scripts/performance/audit-delivery.mjs ORIGIN [OUTPUT.json] [--vercel]')
const origin = new URL(originArg).origin
const results = []
const checks = []
const check = (name, pass, detail) => checks.push({ name, pass, detail })
const directRequest = (pathname, extra = {}) => new Promise((resolve, reject) => {
  const url = new URL(pathname, origin)
  if (url.origin !== origin) return reject(new Error('Only same-origin assets are audited'))
  const transport = url.protocol === 'https:' ? https : http
  const req = transport.get(url, { headers: { 'accept-encoding': 'br, gzip', 'user-agent': 'RacingGameDeliveryAudit/1.0', ...extra } }, response => {
    const chunks = []
    response.on('data', chunk => chunks.push(chunk))
    response.on('error', reject)
    response.on('end', () => {
      try {
        const wire = Buffer.concat(chunks)
        const encoding = response.headers['content-encoding']
        const body = encoding === 'gzip' ? gunzipSync(wire) : encoding === 'br' ? brotliDecompressSync(wire) : encoding === 'deflate' ? inflateSync(wire) : wire
        // Retain only delivery headers, not cookies/authentication information.
        const headers = Object.fromEntries(['content-type', 'content-encoding', 'cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control', 'etag', 'vary', 'x-vercel-cache', 'age', 'accept-ranges', 'content-range', 'content-security-policy', 'x-content-type-options', 'location'].filter(key => response.headers[key] !== undefined).map(key => [key, response.headers[key]]))
        const record = { path: pathname, requestHeaders: extra, status: response.statusCode, headers, wireBodyBytes: wire.length, decodedBytes: body.length }
        results.push(record)
        resolve({ record, body })
      } catch (error) { reject(error) }
    })
  })
  req.setTimeout(60000, () => req.destroy(new Error(`Timed out: ${pathname}`)))
  req.on('error', reject)
})
// For protected previews, let the official CLI manage authentication. Never read
// credentials or put bypass headers/cookies in the retained report.
const run = promisify(execFile)
const request = !useVercel ? directRequest : async (pathname, extra = {}) => {
  const url = new URL(pathname, origin)
  if (url.origin !== origin) throw new Error('Only same-origin assets are audited')
  const folder = await mkdtemp(path.join(tmpdir(), 'race-delivery-'))
  try {
    const headerFile = path.join(folder, 'headers')
    const bodyFile = path.join(folder, 'body')
    const arguments_ = ['--yes', 'vercel@latest', 'curl', url.href, '--', '--silent', '--show-error', '--max-time', '60', '--dump-header', headerFile, '--output', bodyFile]
    for (const [key, value] of Object.entries({ 'accept-encoding': 'br, gzip', ...extra })) arguments_.push('--header', `${key}: ${value}`)
    await run('npx', arguments_, { timeout: 90000, maxBuffer: 1024 * 1024 })
    const rawHeaders = await readFile(headerFile, 'utf8')
    const finalHeaders = rawHeaders.trim().split(/\r?\n\r?\n/).filter(block => /^HTTP\//.test(block)).at(-1)
    if (!finalHeaders) throw new Error(`No response headers for ${pathname}`)
    const [statusLine, ...lines] = finalHeaders.split(/\r?\n/)
    const status = Number(statusLine.match(/^HTTP\/\S+ (\d+)/)?.[1])
    const allHeaders = Object.fromEntries(lines.map(line => {
      const colon = line.indexOf(':')
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()]
    }))
    const wire = await readFile(bodyFile).catch(error => {
      // curl may omit its output file for a bodyless conditional response.
      if (error.code === 'ENOENT' && (status === 304 || status === 204)) return Buffer.alloc(0)
      throw error
    })
    const encoding = allHeaders['content-encoding']
    const body = encoding === 'gzip' ? gunzipSync(wire) : encoding === 'br' ? brotliDecompressSync(wire) : encoding === 'deflate' ? inflateSync(wire) : wire
    const headers = Object.fromEntries(['content-type', 'content-encoding', 'cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control', 'etag', 'vary', 'x-vercel-cache', 'age', 'accept-ranges', 'content-range', 'content-security-policy', 'x-content-type-options', 'location'].filter(key => allHeaders[key] !== undefined).map(key => [key, allHeaders[key]]))
    const record = { path: pathname, requestHeaders: extra, status, headers, wireBodyBytes: wire.length, decodedBytes: body.length }
    results.push(record)
    return { record, body }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}
const header = (record, name) => String(record.headers[name] ?? '')
const revalidates = record => !/immutable/i.test(header(record, 'cache-control')) && /(?:max-age=0|no-cache)/i.test(header(record, 'cache-control'))
const root = await request('/')
check('HTML is served', root.record.status === 200 && /text\/html/.test(header(root.record, 'content-type')), root.record.status)
if (root.record.status !== 200) throw new Error(`Cannot inspect app HTML (status ${root.record.status}); no auth bypass attempted`)
check('HTML revalidates across releases', revalidates(root.record), header(root.record, 'cache-control'))
const html = root.body.toString('utf8')
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1])
const styles = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css)"/g)].map(match => match[1])
const assets = [...new Set([...scripts, ...styles])].filter(url => new URL(url, origin).origin === origin)
check('HTML references local build assets', assets.length > 0, assets)
const visitedAssets = new Set()
for (let assetIndex = 0; assetIndex < assets.length; assetIndex++) {
  const asset = assets[assetIndex]
  if (visitedAssets.has(asset)) continue
  visitedAssets.add(asset)
  const { record, body } = await request(asset)
  if (asset.endsWith('.js')) {
    // Follow only observed engine/audio-worklet references, not guessed hash URLs.
    for (const match of body.toString('utf8').matchAll(/["'`](?:\/?assets\/|\.\/)?((?:Game|engineWorklet)-[\w-]+\.js)["'`]/g)) {
      const referenced = new URL(`./${match[1]}`, new URL(asset, origin)).pathname
      if (!assets.includes(referenced)) assets.push(referenced)
    }
  }
  check(`${asset}: MIME`, record.status === 200 && (asset.endsWith('.css') ? /text\/css/ : /(?:application|text)\/javascript/).test(header(record, 'content-type')), header(record, 'content-type'))
  check(`${asset}: content-hashed URL`, /-[\w-]{8,}\.(?:js|css)$/.test(asset), asset)
  check(`${asset}: immutable cache`, /max-age=31536000/.test(header(record, 'cache-control')) && /immutable/.test(header(record, 'cache-control')), header(record, 'cache-control'))
  check(`${asset}: transfer compression`, record.decodedBytes < 1024 || /^(?:gzip|br)$/.test(header(record, 'content-encoding')), { encoding: header(record, 'content-encoding'), wireBytes: record.wireBodyBytes, decodedBytes: record.decodedBytes })
}
const metadata = await request('/models/tracks/nurburgring/track.json')
check('Track metadata MIME', metadata.record.status === 200 && /application\/json/.test(header(metadata.record, 'content-type')), metadata.record.status)
check('Unversioned metadata revalidates', revalidates(metadata.record), header(metadata.record, 'cache-control'))
if (metadata.record.headers.etag) {
  const conditional = await request(metadata.record.path, { 'if-none-match': metadata.record.headers.etag })
  check('Metadata conditional GET', conditional.record.status === 304 && conditional.record.wireBodyBytes === 0, conditional.record.status)
} else check('Metadata ETag present', false, null)
const glb = await request('/models/cars/porsche911/porsche911_low.glb')
check('GLB MIME and magic bytes', glb.record.status === 200 && /model\/gltf-binary/.test(header(glb.record, 'content-type')) && glb.body.subarray(0, 4).toString() === 'glTF', header(glb.record, 'content-type'))
check('Unversioned GLB revalidates', revalidates(glb.record), header(glb.record, 'cache-control'))
const image = await request('/previews/tracks/nurburgring.webp')
check('Preview image MIME', image.record.status === 200 && /image\/webp/.test(header(image.record, 'content-type')), header(image.record, 'content-type'))
check('Unversioned image revalidates', revalidates(image.record), header(image.record, 'cache-control'))
const audio = await request('/audio/porsche911/engine-bank.wav', { range: 'bytes=0-127', 'accept-encoding': 'identity' })
check('Audio supports byte ranges', audio.record.status === 206 && header(audio.record, 'content-range').startsWith('bytes 0-127/') && audio.body.length === 128 && /audio\//.test(header(audio.record, 'content-type')), { status: audio.record.status, range: header(audio.record, 'content-range') })
for (const missing of ['/assets/__delivery_missing__-AbCd1234.js', '/assets/__delivery_missing__-AbCd1234.wasm', '/models/__delivery_missing__.glb', '/previews/__delivery_missing__.webp']) {
  const { record, body } = await request(missing)
  check(`${missing}: real missing-file response`, record.status === 404 && !body.equals(root.body), record.status)
  check(`${missing}: no long-lived negative cache`, !/immutable|max-age=[1-9]/i.test(header(record, 'cache-control')), header(record, 'cache-control'))
}
const report = { capturedAt: new Date().toISOString(), origin, transport: useVercel ? 'authenticated-vercel-cli' : 'direct-http', passed: checks.every(item => item.pass), checks, responses: results,
  limitations: ['HTTP delivery audit only; no frame-time or driving claims.', 'Missing WASM handling is probed; successful WASM delivery needs a real emitted WASM asset. This build embeds Rapier in engine JS.', 'Meshopt workers are constructed from blobs; headers alone do not verify worker execution.', 'Compressed body sizes exclude transport/TLS/header overhead.'] }
await mkdir(path.dirname(outputArg), { recursive: true })
await writeFile(outputArg, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ origin, output: outputArg, passed: report.passed, checks: checks.length, failures: checks.filter(item => !item.pass) }, null, 2))
if (!report.passed) process.exitCode = 1
