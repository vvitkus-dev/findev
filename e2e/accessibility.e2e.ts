import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { producerState } from './support/dashboard';

// Spec 6 (docs/QUALITY_GATES_PLAN.md Q3.3): axe on each page, WCAG 2 A/AA rules, with zero
// serious or critical violations. Each page is scanned in a settled, representative state.

/** Serious and critical violations as `rule: selectors` lines, so a failure names the culprit. */
async function seriousViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('dashboard has no serious accessibility violations', async ({ page }) => {
  // Arrange
  await page.goto('dashboard');
  await expect(producerState(page)).toHaveText('Running');

  // Act
  const violations = await seriousViolations(page);

  // Assert
  expect(violations).toEqual([]);
});

test('settings with a field error has no serious accessibility violations', async ({ page }) => {
  // Arrange
  await page.goto('settings');
  await page.getByLabel('Instruments').fill('0');
  await expect(page.getByText('Must be between 1 and 50')).toBeVisible();

  // Act
  const violations = await seriousViolations(page);

  // Assert
  expect(violations).toEqual([]);
});

test('the error banner has no serious accessibility violations', async ({ page, context }) => {
  // Arrange
  await context.route('**/wasm/producer.wasm', (route) => route.fulfill({ status: 404 }));
  await page.goto('dashboard');
  await expect(page.getByRole('alert')).toBeVisible();

  // Act
  const violations = await seriousViolations(page);

  // Assert
  expect(violations).toEqual([]);
});
