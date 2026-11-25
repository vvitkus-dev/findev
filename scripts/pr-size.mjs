#!/usr/bin/env node
// PR-size gate (specs/quality-gates/tasks.md Q4.3): a big AI-generated PR is hard to review, so
// fail when it changes more than MAX lines. Generated or vendored files don't count.
// Usage: node scripts/pr-size.mjs <base-ref> [--max 600]   (compares <base-ref>...HEAD)
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  options: { max: { type: 'string', default: '600' } },
  allowPositionals: true,
});
const base = positionals[0];
if (base === undefined) {
  console.error('usage: node scripts/pr-size.mjs <base-ref> [--max 600]');
  process.exit(2);
}
const MAX = Number(values.max);
const EXCLUDED = [/^package-lock\.json$/, /^e2e\/__screenshots__\//, /^\.claude\/skills\//];

const diff = spawnSync('git', ['diff', '--numstat', `${base}...HEAD`], { encoding: 'utf8' });
if (diff.status !== 0) {
  console.error(`pr-size: git diff failed: ${diff.stderr}`);
  process.exit(2);
}

let counted = 0;
let skipped = 0;
for (const line of diff.stdout.split('\n').filter(Boolean)) {
  const [added, deleted, path = ''] = line.split('\t');
  // Binary files report "-" for both counts; they are not lines to review.
  const lines = (Number(added) || 0) + (Number(deleted) || 0);
  if (EXCLUDED.some((re) => re.test(path))) skipped += lines;
  else counted += lines;
}

const summary = `pr-size: ${counted} changed lines (max ${MAX}; ${skipped} in excluded files)`;
if (counted > MAX) {
  console.error(`${summary}\nThis PR is too big to review well — split the PR.`);
  process.exit(1);
}
console.log(summary);
