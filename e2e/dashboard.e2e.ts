import { expect, test } from '@playwright/test';
import { metricRows, producerState, readRows } from './support/dashboard';

// Scenario E1 (specs/quality-gates/design.md §3.1): the real build, worker and Wasm stream market data.
// Only invariants are asserted: the values themselves are random.

test('dashboard boots with five live instruments', { tag: '@smoke' }, async ({ page }) => {
  // Act
  await page.goto('dashboard');

  // Assert
  await expect(producerState(page)).toHaveText('Running');
  await expect(metricRows(page)).toHaveCount(5);
});

test(
  'every instrument shows a consistent quote within 3 s',
  { tag: '@smoke' },
  async ({ page }) => {
    // Arrange
    await page.goto('dashboard');

    // Act
    await expect
      .poll(async () => (await readRows(page)).every((r) => r.volume > 0), { timeout: 3_000 })
      .toBe(true);
    const rows = await readRows(page);

    // Assert
    for (const row of rows) {
      expect.soft(row.last, row.symbol).toBeGreaterThan(0);
      expect.soft(row.spread, row.symbol).toBeGreaterThan(0);
      expect.soft(row.vwap, row.symbol).toBeGreaterThan(0);
      expect.soft(row.imbalance, row.symbol).toBeGreaterThanOrEqual(-1);
      expect.soft(row.imbalance, row.symbol).toBeLessThanOrEqual(1);
    }
  },
);
