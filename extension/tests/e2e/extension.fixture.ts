/** Loads a built extension into Chromium: the debug + mock-voice build (pnpm build:e2e) by default. */
import { join } from 'node:path';
import { chromium, test as base, type BrowserContext, type Worker } from '@playwright/test';

export const OUTPUT_DIR = join(import.meta.dirname, '..', '..', '.output');

export function extensionTest(dir: string) {
  return base.extend<{ context: BrowserContext; worker: Worker; extensionId: string }>({
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take an object pattern.
    context: async ({}, use) => {
      const context = await chromium.launchPersistentContext('', {
        channel: 'chromium',
        viewport: { width: 1280, height: 800 },
        args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`],
      });
      await use(context);
      await context.close();
    },
    worker: async ({ context }, use) => {
      const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
      await use(worker);
    },
    extensionId: async ({ worker }, use) => {
      await use(new URL(worker.url()).host);
    },
  });
}

export const test = extensionTest(join(OUTPUT_DIR, 'chrome-mv3-e2e'));

export { expect } from '@playwright/test';
