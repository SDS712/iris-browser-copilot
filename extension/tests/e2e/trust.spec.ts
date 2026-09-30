/**
 * The automatic site check: a login page on a site that isn't local gets
 * checked by itself. The check's answer is stubbed as "Likely unsafe".
 */
import { expect, test, type Page } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

// A non-local name for the harness server, so the check doesn't skip the page as local.
test.use({ launchOptions: { args: ['--host-resolver-rules=MAP iris-login.test localhost'] } });

const PAGE = (name: string) =>
  `http://iris-login.test:5173/pages/${name}.html?iris_mock_voice=1&iris_debug=1`;

const UNSAFE = {
  contract_version: 1,
  say: "This address looks a lot like samplebank.com, but it isn't the official site, so it's likely unsafe. Want the details?",
  agent_notes: '',
  card: {
    kind: 'trust',
    topic: 'Site check',
    source: 'web',
    lead: 'Likely unsafe. Looks a lot like samplebank.com.',
    verdict: 'likely_unsafe',
    domain: 'iris-login.test',
    reasons: [{ text: 'Looks a lot like samplebank.com', level: 'bad' }],
    checks_line: 'Checks: domain age, look-alike names, public reports.',
  },
  highlight_ids: [],
  quote_text: null,
  sources: [],
  not_found: false,
};

async function open(page: Page, name = 'login'): Promise<string[]> {
  const checked: string[] = [];
  await page.route('**/api/tools/site-trust', async (route) => {
    checked.push(route.request().postData() ?? '');
    await route.fulfill({ json: UNSAFE });
  });
  await page.goto(PAGE(name));
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  return checked;
}

const state = (page: Page) => page.evaluate(() => (window.IrisDebug as IrisDebug).getState());

test('without a session: a chip on the password field opens the trust card', async ({ page }) => {
  const checked = await open(page);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  const chip = page.locator('iris-overlay').getByRole('button', { name: '⚠ Check this site' });
  await expect(chip).toBeVisible();
  expect(checked).toHaveLength(1);
  await chip.click();
  await expect(page.locator('iris-widget article.iris-card').first()).toContainText(
    'Likely unsafe',
  );
});

test('with a session: Iris says it, after a chime, and rings the password field', async ({
  page,
}) => {
  // Talking already on another page of the site, then on to its login page.
  await open(page, 'cart');
  await page.evaluate(() => (window.IrisDebug as IrisDebug).startSession());
  await expect.poll(async () => (await state(page)).session_state).toBe('listening');
  await page.evaluate((url) => {
    location.assign(url);
  }, PAGE('login'));
  await page.waitForURL(/login\.html/);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await expect
    .poll(async () => (await state(page)).spoken.join(' '))
    .toContain('Before you log in: this address looks a lot like samplebank.com');
  expect((await state(page)).cues).toBeGreaterThanOrEqual(1);
  expect((await state(page)).highlight_ids.length).toBeGreaterThan(0);
});
