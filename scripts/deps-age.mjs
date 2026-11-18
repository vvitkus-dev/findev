#!/usr/bin/env node
// Supply-chain gate: every direct dependency must be pinned to an exact version that was
// published at least MIN_AGE_DAYS ago (fresh releases are where hijacked packages show up),
// and package-lock.json must resolve each one to that same version.
// Usage: node scripts/deps-age.mjs [path/to/package.json]   (needs registry access, like npm audit)
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const MIN_AGE_DAYS = 14;
const DAY_MS = 86_400_000;
const EXACT = /^\d+\.\d+\.\d+$/;
const run = promisify(execFile);

const pkgPath = process.argv[2] ?? 'package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const lockPath = join(dirname(pkgPath), 'package-lock.json');
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : null;
const deps = { ...pkg.dependencies, ...pkg.devDependencies };

async function publishTimes(name) {
  const { stdout } = await run('npm', ['view', name, 'time', '--json'], { maxBuffer: 64 << 20 });
  return JSON.parse(stdout);
}

/** Newest stable version in the same major that is old enough — the fix to suggest. */
function suggestion(times, version, now) {
  const major = version.split('.')[0];
  const ok = Object.entries(times)
    .filter(([v, t]) => EXACT.test(v) && v.split('.')[0] === major)
    .filter(([, t]) => now - Date.parse(t) >= MIN_AGE_DAYS * DAY_MS)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]));
  return ok[0]?.[0] ?? 'none';
}

async function check(name, spec, now) {
  if (!EXACT.test(spec)) return `${name}: "${spec}" is not an exact version (pin it)`;
  const locked = lock?.packages?.[`node_modules/${name}`]?.version;
  if (lock && locked !== spec)
    return `${name}: package-lock resolves ${locked}, package.json pins ${spec}`;
  const times = await publishTimes(name);
  const published = times[spec];
  if (!published) return `${name}@${spec}: not found in the registry`;
  const days = (now - Date.parse(published)) / DAY_MS;
  return days >= MIN_AGE_DAYS
    ? null
    : `${name}@${spec}: published ${days.toFixed(1)} days ago (< ${MIN_AGE_DAYS}); use ${suggestion(times, spec, now)}`;
}

// DEPS_AGE_NOW (ISO date) pins "now" so the gate's probes stay deterministic as time passes.
const now = process.env.DEPS_AGE_NOW ? Date.parse(process.env.DEPS_AGE_NOW) : Date.now();
const results = await Promise.all(Object.entries(deps).map(([n, s]) => check(n, s, now)));
const errors = results.filter((r) => r !== null);
if (errors.length) {
  console.error(`FAIL deps:age\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(
  `OK deps:age ${Object.keys(deps).length} direct dependencies pinned, all ≥ ${MIN_AGE_DAYS} days old`,
);
