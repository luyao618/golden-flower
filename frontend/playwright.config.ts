import { defineConfig, devices } from '@playwright/test'

// Each fixture owns an OS-reserved backend socket. No product UI or reused server.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.E2E_BACKEND_PORT ? 1 : 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 45000,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
