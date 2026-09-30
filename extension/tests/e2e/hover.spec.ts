/** Hover to explain: rest on a clause during a session, then tap "Explain". */
import { expect, test } from '@playwright/test';
import type { IrisDebug } from '../../src/core/debug';

test('resting on a clause offers "Explain", and a tap explains that clause', async ({ page }) => {
  await page.goto('/pages/terms.html?iris_mock_voice=1&iris_debug=1');
  await page.waitForFunction(() => window.IrisDebug !== undefined);
  await page.evaluate(() => (window.IrisDebug as IrisDebug).refreshSnapshot());
  const chip = page.locator('iris-overlay').getByRole('button', { name: 'Explain' });

  // No session yet: resting offers nothing.
  const clause = page.getByText('A foreclosure charge of 3%');
  await clause.hover();
  await page.waitForTimeout(2_300);
  await expect(chip).toHaveCount(0);

  await page.evaluate(() => (window.IrisDebug as IrisDebug).startSession());
  await page.mouse.move(0, 0);
  await clause.hover();
  await expect(chip).toBeVisible({ timeout: 4_000 });
  await chip.click();
  await expect(page.locator('iris-widget article.iris-card').first()).toContainText(
    '6 Early repayment of instalments',
  );
});
