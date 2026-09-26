import { defineConfig } from '@playwright/test'

// A dedicated production-preview harness. No backend, provider, existing server
// or normal E2E launcher participates in this package's acceptance checks.
const legacyPort = Number(process.env.SHELL_LEGACY_PORT ?? 4292)
const rebuildPort = Number(process.env.SHELL_REBUILD_PORT ?? 4293)

export default defineConfig({
  testDir: './e2e-shell',
  outputDir: './.shell-test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${rebuildPort}`,
    browserName: 'chromium',
    channel: process.env.SHELL_BROWSER_CHANNEL,
    viewport: { width: 1440, height: 900 },
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `npm run build -- --outDir .shell-preview/legacy && npm run preview -- --outDir .shell-preview/legacy --host 127.0.0.1 --port ${legacyPort} --strictPort`,
      env: { VITE_WEB_GAME_REBUILD: '' },
      url: `http://127.0.0.1:${legacyPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run build -- --outDir .shell-preview/rebuild && npm run preview -- --outDir .shell-preview/rebuild --host 127.0.0.1 --port ${rebuildPort} --strictPort`,
      env: { VITE_WEB_GAME_REBUILD: '1' },
      url: `http://127.0.0.1:${rebuildPort}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
