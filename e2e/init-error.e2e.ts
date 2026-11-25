import { expect, test } from '@playwright/test';
import { producerState, totalVolume } from './support/dashboard';

// Scenario E5 (specs/quality-gates/design.md §3.1): a failed Wasm load is reported, and Retry recovers.
// The route is on the context so the worker's fetch is intercepted too.

const WASM = '**/wasm/producer.wasm';

test(
  'a missing wasm module shows the error banner',
  { tag: '@smoke' },
  async ({ page, context }) => {
    // Arrange
    await context.route(WASM, (route) => route.fulfill({ status: 404, body: 'gone' }));

    // Act
    await page.goto('dashboard');

    // Assert
    await expect(page.getByRole('alert')).toContainText('HTTP 404');
    await expect(producerState(page)).toHaveText('Error');
  },
);

test(
  'retry after the module is back resumes streaming',
  { tag: '@smoke' },
  async ({ page, context }) => {
    // Arrange
    await context.route(WASM, (route) => route.fulfill({ status: 404, body: 'gone' }));
    await page.goto('dashboard');
    await expect(page.getByRole('alert')).toBeVisible();
    await context.unroute(WASM);

    // Act
    await page.getByRole('alert').getByRole('button', { name: 'Retry' }).click();

    // Assert
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(producerState(page)).toHaveText('Running');
    await expect.poll(() => totalVolume(page)).toBeGreaterThan(0);
  },
);
