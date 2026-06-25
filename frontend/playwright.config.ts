import { defineConfig, devices } from '@playwright/test'

const ci = !!process.env.CI

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',

  // Generous timeout — the live pipeline takes ~90s
  timeout: 150_000,
  expect: { timeout: 10_000 },

  fullyParallel: false, // sequential to avoid hammering the backend
  retries: 0,
  workers: 1,

  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/07-responsive.spec.ts',
    },
  ],

  webServer: ci
    ? [
        {
          command: 'python3 -m uvicorn app.main:app --port 8001',
          cwd: '../backend',
          url: 'http://localhost:8001/healthz',
          timeout: 120_000,
          reuseExistingServer: false,
        },
        {
          command: 'npm run dev -- --host 127.0.0.1 --port 5173',
          url: 'http://localhost:5173',
          timeout: 120_000,
          reuseExistingServer: false,
        },
      ]
    : undefined,
})
