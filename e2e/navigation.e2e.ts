import { expect, test } from '@playwright/test';
import { pauseAndSettle, producerState, totalVolume, volumes } from './support/dashboard';

// Spec 4 (docs/QUALITY_GATES_PLAN.md §3.1): the producer outlives page navigation.

test('a paused run stays paused, with the same totals, across navigation', async ({ page }) => {
  // Arrange
  await page.goto('dashboard');
  await expect.poll(() => totalVolume(page)).toBeGreaterThan(0);
  await pauseAndSettle(page);
  const before = await volumes(page);
  const nav = page.getByRole('navigation', { name: 'Main' });

  // Act
  await nav.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await nav.getByRole('link', { name: 'Dashboard' }).click();

  // Assert
  await expect(producerState(page)).toHaveText('Paused');
  expect(await volumes(page)).toEqual(before);
});
