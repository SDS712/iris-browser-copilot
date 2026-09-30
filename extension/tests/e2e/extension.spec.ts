import AxeBuilder from '@axe-core/playwright';
import type { Page, Worker } from '@playwright/test';
import type { WxtBrowser } from 'wxt/browser';
import type { IrisDebug } from '../../src/core/debug';
import { expect, test } from './extension.fixture';

const EXTENSION_ID = 'kjcchlmlkmljbpaobhidapkobbbdfmap';

/** The extension API inside the service worker, where these callbacks run. */
declare const chrome: WxtBrowser;

/** The fixture tab's ID, from the service worker. */
async function tabIdOf(worker: Worker, url: string): Promise<number> {
  return worker.evaluate(async (target) => {
    const [tab] = await chrome.tabs.query({ url: target });
    return tab?.id ?? -1;
  }, url);
}

/** The panel starts on the microphone view (the test browser can't grant it); skip it. */
async function openPanel(panel: Page, url: string): Promise<void> {
  await panel.goto(url);
  await panel.getByRole('button', { name: 'Not now' }).click();
}

/** Page-side debug calls through the content script's bridge (debug builds only). */
function bridge(page: Page, call: string, arg?: string) {
  return page.evaluate(
    ([name, value]) =>
      new Promise((resolve) => {
        const id = Math.random();
        window.addEventListener(
          'message',
          function listen(event: MessageEvent<{ source?: string; id?: number; result?: unknown }>) {
            if (event.data.source !== 'iris-debug-reply' || event.data.id !== id) return;
            window.removeEventListener('message', listen);
            resolve(event.data.result);
          },
        );
        window.postMessage({ source: 'iris-debug', id, call: name, arg: value }, '*');
      }),
    [call, arg] as const,
  );
}

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id);
}

test('the extension loads with its stable ID; the panel renders with no serious accessibility problems', async ({
  context,
  extensionId,
}) => {
  expect(extensionId).toBe(EXTENSION_ID);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(panel.getByRole('button', { name: 'Allow microphone' })).toBeVisible();
  expect(await seriousViolations(panel)).toEqual([]);
  await panel.getByRole('button', { name: 'Not now' }).click();
  await expect(panel.getByText("Hi, I'm Iris.")).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Talk to Iris' })).toBeVisible();
  expect(await seriousViolations(panel)).toEqual([]);
  // A sidebar: the panel fills the side panel's height, with the controls at the bottom.
  const viewport = panel.viewportSize()?.height ?? 0;
  const box = await panel.locator('.iris-panel').boundingBox();
  expect(box?.height).toBe(viewport);
  const bottom = await panel.locator('.iris-welcome__bottom').boundingBox();
  expect((bottom?.y ?? 0) + (bottom?.height ?? 0)).toBe(viewport);
  await panel.getByRole('button', { name: 'Settings' }).click();
  // Axe reads colours mid fade-in as low contrast: let the popover finish appearing.
  await panel
    .locator('.iris-popover')
    .evaluate((popover) => Promise.all(popover.getAnimations().map((a) => a.finished)));
  await expect(panel.getByRole('button', { name: 'Female' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await seriousViolations(panel)).toEqual([]);
});

test('content script privacy: typed values never appear in the snapshot', async ({ context }) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5173/plain/form.html');
  const typed: string[] = [];
  const inputs = page.locator('input:not([type=checkbox]):not([type=radio])');
  for (let i = 0; i < (await inputs.count()); i += 1) {
    const input = inputs.nth(i);
    const type = await input.getAttribute('type');
    const value = type === 'date' ? '1991-02-03' : `TYPED-${String(i)}-${String(i * 13)}`;
    await input.fill(value);
    typed.push(value);
  }
  await page.getByLabel('Employment type').selectOption('Student');
  await expect.poll(() => bridge(page, 'lastSnapshot')).not.toBeNull();
  const json = JSON.stringify(await bridge(page, 'lastSnapshot'));
  for (const value of typed) expect(json).not.toContain(value);
  // The select's options are page text; which one was chosen is never recorded.
  expect(json).not.toMatch(/"(value|selected)"/);
  expect(json).toContain('"filled":true');
});

test('the panel follows a tab: registers it, answers from it and marks the clause', async ({
  context,
  worker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5173/plain/terms.html');
  const tabId = await tabIdOf(worker, 'http://localhost:5173/plain/terms.html');
  const panel = await context.newPage();
  await openPanel(panel, `chrome-extension://${extensionId}/sidepanel.html?tabId=${String(tabId)}`);
  await panel.waitForFunction(() => window.IrisDebug !== undefined);
  expect(
    await panel.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot()),
  ).toMatchObject({
    page_type: 'terms',
  });
  const result = await panel.evaluate(() =>
    (window.IrisDebug as IrisDebug).runTool('ask_page', { question: 'Can I cancel anytime?' }),
  );
  expect(result).toMatchObject({ card: { kind: 'answer' } });
  await expect(panel.locator('article.iris-card').first()).toContainText('From this page');
  await expect
    .poll(async () =>
      ((await bridge(page, 'overlayRects')) as { kind: string }[]).map((r) => r.kind),
    )
    .toContain('marker');
});

test('with the panel closed: the badge counts the client flags and chips still work', async ({
  context,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5173/plain/checkout.html');
  const tabId = await tabIdOf(worker, 'http://localhost:5173/plain/checkout.html');
  await expect
    .poll(() => worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId))
    .toBe('2');
  await expect(
    page.locator('iris-overlay').getByRole('button', { name: 'Show reject option' }),
  ).toBeVisible();
});

test('pages Iris can’t read show a notice', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto('chrome://version');
  const panel = await context.newPage();
  const worker = context.serviceWorkers()[0];
  const tabId = worker ? await tabIdOf(worker, 'chrome://version/') : -1;
  await openPanel(panel, `chrome-extension://${extensionId}/sidepanel.html?tabId=${String(tabId)}`);
  await expect(
    panel.getByText("I can't read this kind of page. Try me on a website."),
  ).toBeVisible();
});

test('a chip tapped with the panel closed opens the panel, which carries out the chip', async ({
  context,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5173/plain/checkout.html');
  const overlay = page.locator('iris-overlay');
  await overlay.getByRole('button', { name: 'Show reject option' }).click();
  await expect
    .poll(() =>
      worker.evaluate(async () =>
        (await chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })).map(
          (c) => c.documentUrl,
        ),
      ),
    )
    .toEqual([expect.stringContaining('/sidepanel.html') as unknown]);
  await expect(overlay.getByText("The reject option is inside 'Manage choices'.")).toBeVisible();
});

test('the panel keeps the tab’s journey as it navigates', async ({
  context,
  worker,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto('http://localhost:5173/plain/cart.html');
  const tabId = await tabIdOf(worker, 'http://localhost:5173/plain/cart.html');
  const panel = await context.newPage();
  await openPanel(panel, `chrome-extension://${extensionId}/sidepanel.html?tabId=${String(tabId)}`);
  await panel.waitForFunction(() => window.IrisDebug !== undefined);
  await panel.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  // A page left within 3 seconds is a bounce, not part of the journey.
  await page.waitForTimeout(3_200);
  await page.goto('http://localhost:5173/plain/checkout.html');
  const journey = () => panel.evaluate(() => (window.IrisDebug as IrisDebug).journey());
  await expect
    .poll(async () => (await journey()).pages.map((p) => new URL(p.url).pathname))
    .toEqual(['/plain/cart.html', '/plain/checkout.html']);
  // No session: the changed price is a notice in the panel.
  await expect(panel.getByText('the travel backpack here is ₹2,499')).toBeVisible();
});
