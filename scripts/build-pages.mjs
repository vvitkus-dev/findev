#!/usr/bin/env node
// Production build shaped like the GitHub Pages deploy: served under `/<base>/`, with
// `404.html` as the SPA fallback for deep links. Used by CI (deploy) and the E2E server.
// Usage: [BUILD_SHA=abc1234] node scripts/build-pages.mjs [--base findev]
//   BUILD_SHA (optional) is shown in the footer; without it the footer says "dev".
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
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

// Pages serves 404.html for any unknown path, so deep links such as /settings boot the app.
copyFileSync(`${OUT}/index.html`, `${OUT}/404.html`);
console.log(`build-pages: ${OUT} ready for /${values.base}/ (404.html fallback)`);
