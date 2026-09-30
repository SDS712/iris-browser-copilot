import { defineConfig, devices } from '@playwright/test';

/**
 * Journey and accessibility tests against dist/ and the backend in fake mode.
 */
export default defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4322', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --port 8000 --no-access-log',
      cwd: '../backend',
      env: { IRIS_FAKE_UPSTREAMS: '1', DATA_DIR: '.data-e2e' },
      url: 'http://localhost:8000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'node scripts/test-server.mjs',
      url: 'http://localhost:4322/demo/',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
