import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { metricRows, producerBar, producerState } from './support/dashboard';

// Spec 3 (docs/QUALITY_GATES_PLAN.md §3.1): invalid input blocks Apply; Apply starts a new run.

const INVALID = [
  { value: '0', message: 'Must be between 1 and 50' },
  { value: '1.5', message: 'Must be a whole number' },
] as const;

for (const { value, message } of INVALID) {
  test(`instruments "${value}" shows an error and disables Apply`, async ({ page }) => {
    // Arrange
    await page.goto('settings');

    // Act
    await page.getByLabel('Instruments').fill(value);

    // Assert
    await expect(page.getByText(message)).toBeVisible();
    await expect(page.getByLabel('Instruments')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });
}

async function fillValid(page: Page): Promise<void> {
  await page.goto('settings');
  await page.getByLabel('Instruments').fill('10');
  await page.getByLabel('Updates per batch').fill('50');
  await page.getByLabel('Batch interval').fill('100');
}

test('apply confirms the new run', async ({ page }) => {
  // Arrange
  await fillValid(page);

  // Act
  await page.getByRole('button', { name: 'Apply' }).click();

  // Assert
  await expect(page.getByRole('status')).toHaveText(
    'Run #2 started with 10 instruments, 50 updates every 100 ms.',
  );
});

test('after apply the dashboard streams run #2 with the new instruments', async ({ page }) => {
  // Arrange
  await fillValid(page);

  // Act
  await page.getByRole('button', { name: 'Apply' }).click();
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Dashboard' })
    .click();

  // Assert
  await expect(producerBar(page)).toContainText('Run #2');
  await expect(producerBar(page)).toContainText('10 instruments · 50 updates every 100 ms');
  await expect(producerState(page)).toHaveText('Running');
  await expect(metricRows(page)).toHaveCount(10);
});
