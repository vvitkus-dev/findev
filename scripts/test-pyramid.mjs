#!/usr/bin/env node
// Testing-pyramid gate (docs/QUALITY_GATES_PLAN.md Q4.1): counts tests per layer and fails
// when the suite drifts into an "ice-cream cone" (too many slow E2E tests, too few unit tests).
//
//   unit        = Angular *.spec.ts (not *.integration.spec.ts) + Rust #[test]s
//   integration = Angular *.integration.spec.ts + the Node suite on the real .wasm (wasm-tests/)
//   e2e         = Playwright (every project, @visual included)
//
// Usage:
//   node scripts/test-pyramid.mjs                 # collect (needs reports/vitest-unit.json from test:ci)
//   node scripts/test-pyramid.mjs --counts f.json # check given {"unit","integration","e2e"} counts
// Writes the table to $GITHUB_STEP_SUMMARY when it is set.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { parseArgs } from 'node:util';

const LIMITS = { maxE2eShare: 0.1, minUnitShare: 0.6, minIntegration: 3 };
const VITEST_REPORT = 'reports/vitest-unit.json';

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    env: {
      ...process.env,
      PATH: [process.env.PATH, join(homedir(), '.cargo', 'bin')].join(delimiter),
      ...env,
    },
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  }
  return r.stdout;
}

/** Angular Vitest JSON report → [unit, integration] test counts. */
function angularCounts() {
  if (!existsSync(VITEST_REPORT)) {
    throw new Error(`${VITEST_REPORT} not found — run npm run test:ci first`);
  }
  const report = JSON.parse(readFileSync(VITEST_REPORT, 'utf8'));
  let unit = 0;
  let integration = 0;
  for (const file of report.testResults) {
    const n = file.assertionResults.length;
    if (file.name.endsWith('.integration.spec.ts')) integration += n;
    else unit += n;
  }
  return [unit, integration];
}

const rustCount = () =>
  run('node', ['scripts/cargo.mjs', 'test', '-q', '--', '--list', '--format', 'terse'])
    .split('\n')
    .filter((line) => line.endsWith(': test')).length;

const wasmSuiteCount = () =>
  JSON.parse(run('npx', ['vitest', 'list', '--config', 'wasm-tests/vitest.config.mts', '--json']))
    .length;

function e2eCount() {
  // E2E_VISUAL=1: list the Linux-only @visual specs too, so every platform counts the same.
  const out = run('npx', ['playwright', 'test', '--list'], { E2E_VISUAL: '1' });
  const total = /Total: (\d+) tests?/.exec(out);
  if (total === null) throw new Error(`unexpected playwright --list output:\n${out}`);
  return Number(total[1]);
}

function collect() {
  const [angularUnit, angularIntegration] = angularCounts();
  const rust = rustCount();
  const wasm = wasmSuiteCount();
  return {
    unit: angularUnit + rust,
    integration: angularIntegration + wasm,
    e2e: e2eCount(),
    detail: { angularUnit, rust, angularIntegration, wasm },
  };
}

/** Pure check: the failures for a set of counts (empty when the pyramid holds). */
function check({ unit, integration, e2e }) {
  const total = unit + integration + e2e;
  const failures = [];
  if (total === 0) return ['no tests found'];
  if (e2e / total > LIMITS.maxE2eShare) {
    failures.push(
      `ice-cream cone detected: E2E is ${pct(e2e / total)} of tests (max ${pct(LIMITS.maxE2eShare)})`,
    );
  }
  if (unit / total < LIMITS.minUnitShare) {
    failures.push(`unit tests are ${pct(unit / total)} of tests (min ${pct(LIMITS.minUnitShare)})`);
  }
  if (integration < LIMITS.minIntegration) {
    failures.push(`only ${integration} integration tests (min ${LIMITS.minIntegration})`);
  }
  return failures;
}

const pct = (x) => `${(x * 100).toFixed(1)} %`;

function table({ unit, integration, e2e, detail }) {
  const total = unit + integration + e2e;
  const row = (layer, n, limit, source) =>
    `| ${layer} | ${n} | ${pct(n / total)} | ${limit} | ${source} |`;
  return [
    '### Testing pyramid',
    '',
    '| Layer | Tests | Share | Limit | Source |',
    '| --- | ---: | ---: | --- | --- |',
    row('E2E', e2e, `≤ ${pct(LIMITS.maxE2eShare)}`, 'Playwright'),
    row(
      'Integration',
      integration,
      `≥ ${LIMITS.minIntegration} tests`,
      detail ? `${detail.angularIntegration} Angular + ${detail.wasm} Wasm suite` : '—',
    ),
    row(
      'Unit',
      unit,
      `≥ ${pct(LIMITS.minUnitShare)}`,
      detail ? `${detail.angularUnit} Angular + ${detail.rust} Rust` : '—',
    ),
    `| **Total** | **${total}** | | | |`,
  ].join('\n');
}

const { values } = parseArgs({ options: { counts: { type: 'string' } } });
let counts;
try {
  counts = values.counts ? JSON.parse(readFileSync(values.counts, 'utf8')) : collect();
} catch (error) {
  console.error(`test-pyramid: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}
const summary = table(counts);
const failures = check(counts);
const report = failures.length
  ? `${summary}\n\n**FAIL**\n${failures.map((f) => `- ${f}`).join('\n')}`
  : `${summary}\n\nPyramid OK.`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
process.exit(failures.length ? 1 : 0);
