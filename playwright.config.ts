import { defineConfig, devices } from '@playwright/test';

// E2E suite (docs/QUALITY_GATES_PLAN.md Q3). Runs against the Pages-shaped production build
// (`npm run build:pages`) served under /findev/ by scripts/serve-dist.mjs, or against a live
// URL when E2E_BASE_URL is set (post-deploy smoke, no local server).
const CI = Boolean(process.env['CI']);
const PORT = 4300;
const liveUrl = process.env['E2E_BASE_URL'];
// A trailing slash makes relative paths (`page.goto('settings')`) resolve under the base.
const baseURL = (liveUrl ?? `http://localhost:${String(PORT)}/findev/`).replace(/\/?$/, '/');

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { outputFolder: 'reports/playwright', open: 'never' }]],
  outputDir: 'reports/playwright-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(liveUrl === undefined && {
    webServer: {
      command: `node scripts/serve-dist.mjs --port ${String(PORT)}`,
      url: baseURL,
      reuseExistingServer: !CI,
      timeout: 15_000,
    },
  }),
});
