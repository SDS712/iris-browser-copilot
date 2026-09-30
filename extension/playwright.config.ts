import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the backend in fake mode and the widget harness.
 * Real-service checks live in playwright.real.config.ts.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
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
      // Vite directly: pnpm puts it in its own process group, so Playwright couldn't stop it
      // and never exited.
      command: 'vite --config vite.widget.config.ts',
      url: 'http://localhost:5173/',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
