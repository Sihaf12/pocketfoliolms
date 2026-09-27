/**
 * End-to-end: the studio and console in Chromium, at phone width (390)
 * and on a desktop, against their own database (academy_e2e), seeded
 * with the demo academies. `npm run test:e2e` builds and starts both
 * servers through scripts/demo.sh on ports of their own, so a running
 * demo is left alone.
 */
import { defineConfig, devices } from '@playwright/test';

const STUDIO_PORT = 3301;
// *.academy.test resolves to this machine inside the browser only; /etc/hosts is not needed.
const launchOptions = { args: ['--host-resolver-rules=MAP *.academy.test 127.0.0.1'] };

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://gtl.academy.test:${STUDIO_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, launchOptions } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 }, launchOptions } },
  ],
  webServer: {
    command: 'sh scripts/demo.sh',
    env: {
      DEMO_DATABASE: 'academy_e2e', DEMO_PORT: '3201', DEMO_STUDIO_PORT: String(STUDIO_PORT), DEMO_DIR: '.demo/e2e',
      // Google is played by a local stand-in; a developer's own .env is not read.
      DEMO_ENV_FILE: '/dev/null', DEMO_FAKE_GOOGLE_PORT: '3302',
      // Every request comes from 127.0.0.1, so the per-address limits are lifted for the run.
      RATE_TENANT_PER_MIN: '100000', RATE_LOGIN_PER_MIN: '100000', RATE_CONSOLE_PER_MIN: '100000',
    },
    port: STUDIO_PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
