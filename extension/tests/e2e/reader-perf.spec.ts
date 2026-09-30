import { expect, test } from '@playwright/test';

test('the reader snapshots a 5,000-element page in under 150 ms', async ({ page }) => {
  await page.goto('/perf.html');
  await page.waitForFunction(() => typeof window.irisPerf === 'function');
  const { elements, timings } = await page.evaluate(() => {
    if (!window.irisPerf) throw new Error('no perf hook');
    return window.irisPerf();
  });
  expect(elements).toBeGreaterThanOrEqual(5_000);
  const median = [...timings].sort((a, b) => a - b)[Math.floor(timings.length / 2)] ?? Infinity;
  console.log(
    `reader: ${String(elements)} elements, median ${median.toFixed(1)} ms (${timings.map((t) => t.toFixed(0)).join(', ')})`,
  );
  expect(median).toBeLessThan(150);
});
