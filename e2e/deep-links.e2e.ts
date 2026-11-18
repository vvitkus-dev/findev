import { expect, test } from '@playwright/test';
import { producerState } from './support/dashboard';

// Every route is a real page (scripts/build-pages.mjs), so a deep link or reload answers 200:
// crawlers and Lighthouse reject a 404 even when the SPA fallback renders the app.

for (const route of ['dashboard', 'settings']) {
  test(
    `deep link /${route} answers 200 and renders the page`,
    { tag: '@smoke' },
    async ({ page }) => {
      // Act
      const response = await page.goto(route);

      // Assert
      expect(response?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 2 })).toHaveText(new RegExp(route, 'i'));
    },
  );
}

test(
  'an unknown URL falls back to the app, which shows the dashboard',
  { tag: '@smoke' },
  async ({ page }) => {
    // Act
    const response = await page.goto('no-such-page');

    // Assert
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(producerState(page)).toHaveText('Running');
  },
);
