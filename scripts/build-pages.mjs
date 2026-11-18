#!/usr/bin/env node
// Production build shaped like the GitHub Pages deploy: served under `/<base>/`, one HTML page
// per route (deep links answer 200), and `404.html` as the SPA fallback for unknown URLs.
// Used by CI (deploy) and the E2E server.
// Usage: [BUILD_SHA=abc1234] node scripts/build-pages.mjs [--base findev]
//   BUILD_SHA (optional) is shown in the footer; without it the footer says "dev".
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { base: { type: 'string', default: 'findev' } } });
const OUT = 'dist/findev/browser';
const sha = process.env.BUILD_SHA ?? '';
if (sha !== '' && !/^[0-9a-f]{7,40}$/.test(sha)) {
  console.error(`build-pages: BUILD_SHA must be a hex commit SHA, got "${sha}"`);
  process.exit(1);
}

const args = ['ng', 'build', '--base-href', `/${values.base}/`];
if (sha !== '') args.push('--define', `BUILD_SHA='${sha}'`);
const build = spawnSync('npx', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (build.status !== 0) process.exit(build.status ?? 1);

// One page per route, so a deep link such as /settings is a real file served with status 200
// (Pages serves `settings.html` for `/settings`). Crawlers and Lighthouse reject 404 responses.
// The paths come from app.routes.ts, so a new route gets its page without editing this script.
const routes = [
  ...readFileSync('src/app/app.routes.ts', 'utf8').matchAll(/path: '([a-z0-9-]+)'/g),
].map((m) => m[1]);
if (routes.length === 0) {
  console.error('build-pages: no routes found in src/app/app.routes.ts');
  process.exit(1);
}
for (const route of routes) copyFileSync(`${OUT}/index.html`, `${OUT}/${route}.html`);

// Anything else (an unknown or mistyped URL) still boots the app, which redirects it.
copyFileSync(`${OUT}/index.html`, `${OUT}/404.html`);
console.log(
  `build-pages: ${OUT} ready for /${values.base}/ (pages: ${routes.join(', ')}; 404.html fallback)`,
);
