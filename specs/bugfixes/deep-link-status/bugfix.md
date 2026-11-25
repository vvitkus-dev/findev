# Bugfix — Deep links answer HTTP 404 on GitHub Pages

> Found by a Lighthouse audit of the live site · Fixed in `24e9312` · Requirements: R1, R24

## Current behaviour

WHEN a browser requests `/findev/dashboard` or `/findev/settings` THEN GitHub Pages serves `404.html` with HTTP status 404. The app still renders, but Lighthouse refuses to audit and crawlers drop the pages.

## Expected behaviour

1. WHEN a known route is requested directly THE SYSTEM SHALL answer HTTP 200 with the app.
2. IF an unknown URL is requested THEN THE SYSTEM SHALL answer HTTP 404 with the app shell, which ends on the Dashboard.

## Unchanged behaviour

- `404.html` stays the SPA fallback for unknown URLs.
- In-app navigation and the `/findev/` base href are unchanged.

## Root cause

Pages has no SPA rewrite: any path without a file is a 404, and the only page was `index.html`.

## Fix

- `build-pages.mjs` writes `<route>.html` for each path in `app.routes.ts`; Pages serves it for the extensionless URL.
- `serve-dist.mjs` resolves `/x` to `x.html` the same way, so E2E covers it locally.

## Tasks

- [x] Regression test: `deep-links.e2e.ts` (`@smoke`, so it also runs on the live site) checks the status codes and that an unknown URL ends on the Dashboard.
- [x] Build and serve fixes.
- [x] `smoke-deploy.mjs` requires 200 for `/dashboard` and `/settings` and 404 with the app shell for an unknown URL; a quality probe fails a deploy whose route page is missing.
