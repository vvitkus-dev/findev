import { expect, test } from '@playwright/test';
import {
  pauseAndSettle,
  producerBar,
  producerState,
  totalVolume,
  volumes,
} from './support/dashboard';

// Spec 2 (docs/QUALITY_GATES_PLAN.md §3.1): Pause stops generation; Resume continues the totals.

test.beforeEach(async ({ page }) => {
  await page.goto('dashboard');
  await expect.poll(() => totalVolume(page)).toBeGreaterThan(0);
});

test('pause freezes every total', async ({ page }) => {
  // Arrange
  await pauseAndSettle(page);
  const before = await volumes(page);

  // Act
  // The one fixed observation window: two default 500 ms intervals with no new batch.
  await page.waitForTimeout(1_000);

  // Assert
  await expect(producerState(page)).toHaveText('Paused');
  expect(await volumes(page)).toEqual(before);
});

test('resume continues from the paused totals', async ({ page }) => {
  // Arrange
  await pauseAndSettle(page);
  const paused = await totalVolume(page);

  // Act
  await producerBar(page).getByRole('button', { name: 'Resume' }).click();

  // Assert
  await expect(producerState(page)).toHaveText('Running');
  await expect.poll(() => totalVolume(page)).toBeGreaterThan(paused);
});
