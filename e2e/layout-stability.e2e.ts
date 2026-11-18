import { expect, test } from '@playwright/test';
import { layoutShift, metricRows, producerState } from './support/dashboard';

// Loading a page must not move anything already on screen: the shell reserves the space for
// the routed page, the status pills keep their width, the table has fixed columns, and the
// active nav link doesn't change width. So no element shifts at all. The only shift left is
// live text: a right-aligned number replacing "—" moves its own start. The total stays 10×
// under Google's "good" CLS (0.1).
const MAX_TOTAL_CLS = 0.01;

test('dashboard loads and starts streaming without any layout shift', async ({ page }) => {
  // Arrange
  await page.goto('dashboard');
  await expect(producerState(page)).toHaveText('Running');
  await expect
    .poll(async () => (await metricRows(page).first().innerText()).includes('$'))
    .toBe(true);

  // Act
  const cls = await layoutShift(page);

  // Assert
  expect(cls.elements).toBe(0);
  expect(cls.total).toBeLessThan(MAX_TOTAL_CLS);
});

test('settings loads without any layout shift', async ({ page }) => {
  // Arrange
  await page.goto('settings');
  await expect(page.getByRole('banner').getByText('Running')).toBeVisible();

  // Act
  const cls = await layoutShift(page);

  // Assert
  expect(cls.elements).toBe(0);
  expect(cls.total).toBeLessThan(MAX_TOTAL_CLS);
});
