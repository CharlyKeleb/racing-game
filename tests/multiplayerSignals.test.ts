import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each(['SIGTERM', 'SIGINT'] as const)('handles %s immediately after reporting readiness', async signal => {
  const child = spawn(process.execPath, ['--import', fileURLToPath(new URL('../server/node_modules/tsx/dist/loader.mjs', import.meta.url)),
    fileURLToPath(new URL('../server/src/index.ts', import.meta.url))], {
    env: { PATH: process.env.PATH, NODE_ENV: 'test', SUPABASE_URL: 'http://127.0.0.1:1',
      SUPABASE_PUBLISHABLE_KEY: 'synthetic-public-key', ALLOWED_ORIGINS: 'http://localhost:5173', PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const closed = once(child, 'close')
  const deadline = setTimeout(() => child.kill('SIGKILL'), 5000)
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.on('data', data => { output += data; if (output.includes('Multiplayer lobby server ready')) resolve() })
      child.stderr.on('data', data => { output += data })
      child.once('error', reject)
      child.once('close', () => { if (!output.includes('Multiplayer lobby server ready')) reject(new Error('Synthetic runner never became ready')) })
    })
    child.kill(signal)
    expect(await closed).toEqual([0, null])
    expect(output).toContain('Multiplayer shutdown { abortedRaces: 0, pendingResultWrites: 0 }')
  } finally {
    clearTimeout(deadline)
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}, 8000)
