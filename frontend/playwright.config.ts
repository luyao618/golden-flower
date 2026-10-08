import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'
import { readLiveProvider } from './e2e/support/liveGame'

const live = readLiveProvider()

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Retrying makes additional paid provider calls and cannot repair a failed gate.
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 480000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 10000,
    navigationTimeout: 15000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Missing credentials skip even on machines without backend dependencies.
  webServer: live.config ? [
    {
      command: 'uv run --frozen --extra dev uvicorn app.main:app --host 127.0.0.1 --port 8000',
      cwd: fileURLToPath(new URL('../backend', import.meta.url)),
      url: 'http://127.0.0.1:8000/health',
      reuseExistingServer: false,
      timeout: 120000,
      env: { DATABASE_URL: 'sqlite+aiosqlite:///:memory:' },
      // Uvicorn access logs include the credential-bearing WebSocket query.
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --strictPort',
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30000,
      // The existing Vite proxy targets localhost; match the IPv4 backend bind.
      env: { NODE_OPTIONS: '--dns-result-order=ipv4first' },
      stdout: 'ignore',
      stderr: 'ignore',
    },
  ] : [],
})
