import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3100);
const WORKER_PORT = Number(process.env.E2E_WORKER_PORT ?? 3199);

export default defineConfig({
  testDir: './e2e',
  // Re-seeds the demo database (wipes it) so every run starts from the same state. E2E_SEED=0 to skip.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] }, testIgnore: /mobile\.spec\.ts/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: `pnpm next start -p ${PORT}`,
      url: `http://localhost:${PORT}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // SLA expiry, sweeper and import jobs run in the worker.
      command: 'pnpm --filter @michio/worker start',
      url: `http://localhost:${WORKER_PORT}`,
      env: { WORKER_HEALTH_PORT: String(WORKER_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
