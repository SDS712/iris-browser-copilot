import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

const FLAGS = '?iris_mock_voice=1&iris_debug=1';

/** The active view with a card: terms fixture, a session, one answer. */
async function activePanel(page: Page) {
  await page.goto(`/pages/terms.html${FLAGS}`);
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  await page.evaluate(() => (window.IrisDebug as IrisDebug).startSession());
  await page.evaluate(() =>
    (window.IrisDebug as IrisDebug).runTool('ask_page', { question: 'Can I cancel anytime?' }),
  );
  const panel = page.locator('iris-widget .iris-widget__panel');
  await expect(panel.locator('article.iris-card')).toBeVisible();
  // Let the card's fade-in finish, so contrast is measured on the settled colours.
  await panel.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  return panel;
}

async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).include('iris-widget').analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`no serious accessibility problems in the active view (${colorScheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await activePanel(page);
    expect(await seriousViolations(page)).toEqual([]);
  });
}

test('keyboard order: header, page strip, cards, footer; visible 2 px focus rings', async ({
  page,
}) => {
  const panel = await activePanel(page);
  await panel.focus();
  const order: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const host = document.querySelector('iris-widget');
        const el = host?.shadowRoot?.activeElement as HTMLElement | null | undefined;
        if (!el) return '';
        const ring = getComputedStyle(el).outlineWidth;
        return `${el.getAttribute('aria-label') ?? el.textContent.trim()}|${ring}`;
      }),
    );
  }
  const labels = order.map((entry) => entry.split('|')[0] ?? '');
  const at = (label: string) => labels.findIndex((l) => l.includes(label));
  expect(at('Settings')).toBeGreaterThanOrEqual(0);
  expect(at('Settings')).toBeLessThan(at('Review'));
  expect(at('Review')).toBeLessThan(at('Show on page'));
  expect(at('Show on page')).toBeLessThan(at('Transcript'));
  for (const entry of order.filter(Boolean)) expect(entry.split('|')[1]).toBe('2px');
});

test('reduced motion: the orb stops animating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const panel = await activePanel(page);
  const animation = await panel
    .locator('.iris-orb')
    .first()
    .evaluate((el) => {
      const parts = [el, ...Array.from(el.querySelectorAll('*'))];
      return parts
        .map((node) => getComputedStyle(node).animationName)
        .filter((name) => name !== 'none');
    });
  expect(animation).toEqual([]);
});

test('at 200% text size (half the space) the panel scrolls instead of cutting things off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 400 });
  const panel = await activePanel(page);
  const layout = await panel.evaluate((el) => {
    const inner = el.querySelector('.iris-panel');
    return {
      horizontal: el.scrollWidth - el.clientWidth,
      scrolls: inner ? getComputedStyle(inner).overflowY === 'auto' : false,
    };
  });
  expect(layout.horizontal).toBeLessThanOrEqual(0);
  expect(layout.scrolls).toBe(true);
  // Everything stays reachable: scrolling the panel brings the footer into view.
  await panel.locator('.iris-panel').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const box = await panel.getByRole('button', { name: 'End' }).boundingBox();
  expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 999) + (box?.height ?? 0)).toBeLessThanOrEqual(400);
});
