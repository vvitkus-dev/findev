import { expect, test } from '@playwright/test';
import { metricRows, pauseAndSettle, producerBar } from './support/dashboard';

// Spec 7 (docs/QUALITY_GATES_PLAN.md Q3.4): layout and styling regressions. Baselines live in
// e2e/__screenshots__ and are rendered only in the pinned Playwright image
// (`npm run e2e:update-snapshots`). Random or time-dependent text is masked, never asserted; the build id is
// hidden by e2e/support/screenshot.css.

test('settings page looks unchanged', { tag: '@visual' }, async ({ page }) => {
  // Arrange
  await page.goto('settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // Act
  // The header pill must have settled: it reads "Initializing" until the worker acknowledges.
  await expect(page.getByRole('banner').getByText('Running')).toBeVisible();

  // Assert
  await expect(page).toHaveScreenshot('settings.png', { fullPage: true });
});

test('paused dashboard layout looks unchanged', { tag: '@visual' }, async ({ page }) => {
  // Arrange
  await page.goto('dashboard');
  await expect(metricRows(page)).toHaveCount(5);
  await expect(producerBar(page).getByRole('button', { name: 'Pause' })).toBeEnabled();

  // Act
  await pauseAndSettle(page);

  // Assert
  await expect(page).toHaveScreenshot('dashboard-paused.png', {
    fullPage: true,
    mask: [metricRows(page).getByRole('cell'), producerBar(page).getByText(/measured|batches/)],
  });
});
