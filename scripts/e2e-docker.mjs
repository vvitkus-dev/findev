#!/usr/bin/env node
// Runs Playwright inside the pinned Playwright image used by CI (amd64, like the GitHub runner),
// so screenshots match CI pixel for pixel. Needs Docker and an existing Pages build.
// Usage: node scripts/e2e-docker.mjs [playwright test args…]
//   e.g. node scripts/e2e-docker.mjs --update-snapshots --grep @visual
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Same image (tag + digest) as the e2e jobs in .github/workflows/ci-deploy.yml.
const workflow = readFileSync('.github/workflows/ci-deploy.yml', 'utf8');
const image = /image: (mcr\.microsoft\.com\/playwright:\S+)/.exec(workflow)?.[1];
if (image === undefined) {
  console.error('e2e-docker: no Playwright image found in ci-deploy.yml');
  process.exit(1);
}
if (!existsSync('dist/findev/browser/404.html')) {
  console.error('e2e-docker: no Pages build — run npm run wasm:build && npm run build:pages first');
  process.exit(1);
}

const args = [
  'run',
  '--rm',
  '--platform=linux/amd64',
  '--ipc=host',
  '-e',
  'CI=',
  '-v',
  `${process.cwd()}:/work`,
  '-w',
  '/work',
  image,
  'npx',
  'playwright',
  'test',
  ...process.argv.slice(2),
];
const run = spawnSync('docker', args, { stdio: 'inherit' });
process.exit(run.status ?? 1);
