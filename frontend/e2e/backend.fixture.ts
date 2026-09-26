import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { test as base, expect } from '@playwright/test'

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend')
const python = process.env.E2E_PYTHON ?? join(
  backendDirectory, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
)

export const test = base.extend<{ backendURL: string }>({
  backendURL: async ({ playwright }, provide, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), 'golden-flower-browser-'))
    const readyFile = join(directory, 'ready.json')
    const child = spawn(python, [
      '-m', 'tests.harness', '--port', process.env.E2E_BACKEND_PORT ?? '0',
      '--ready-file', readyFile,
    ], { cwd: backendDirectory, stdio: ['pipe', 'pipe', 'pipe'] })
    let logs = ''
    let spawnError: Error | undefined
    let exited = false
    const closed = new Promise<void>((resolve) => {
      child.once('close', () => { exited = true; resolve() })
    })
    child.on('error', (error) => { spawnError = error })
    child.stdin.on('error', () => { /* Startup failures are reported from child exit/logs. */ })
    child.stdout.on('data', (data: Buffer) => { logs = (logs + data.toString()).slice(-65536) })
    child.stderr.on('data', (data: Buffer) => { logs = (logs + data.toString()).slice(-65536) })
    try {
      const deadline = Date.now() + 30000
      let url: string | undefined
      while (!url) {
        if (spawnError || exited || Date.now() >= deadline) {
          throw new Error(`Backend startup failed: ${spawnError?.message ?? logs}`)
        }
        try {
          const ready = JSON.parse(await readFile(readyFile, 'utf8')) as { url: string }
          url = ready.url
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          await delay(50)
        }
      }
      const client = await playwright.request.newContext({ baseURL: url })
      try {
        expect((await client.get('/health')).ok()).toBe(true)
        await provide(url)
        const diagnostics = await (await client.get('/__harness__/diagnostics')).json()
        expect(diagnostics.provider_attempts).toEqual([])
        expect(diagnostics.blocked_network).toEqual([])
      } finally {
        await client.dispose()
      }
    } finally {
      // EOF lets uvicorn close SQLite before temporary files disappear, on any OS.
      child.stdin.end()
      const stopped = await Promise.race([
        closed.then(() => true), delay(10000, undefined, { ref: false }).then(() => false),
      ])
      if (!stopped) child.kill('SIGKILL') // Only this fixture's child; never search by port.
      await closed
      await testInfo.attach('backend.log', { body: logs, contentType: 'text/plain' })
      await rm(directory, { recursive: true, force: true })
      if (!spawnError) expect(child.exitCode, 'Backend must shut down cleanly').toBe(0)
    }
  },
})

export { expect }
