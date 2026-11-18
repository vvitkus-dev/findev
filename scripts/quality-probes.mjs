#!/usr/bin/env node
// Proves non-ESLint quality tools actually fail on bad input (docs/QUALITY_GATES_PLAN.md).
// Each probe: create throwaway files → run the tool → assert exit code (and output) → clean up.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** Run a command; returns { code, out }. */
function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', input, shell: false });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Write probe files, run `check`, always delete the files. */
function withFiles(files, check) {
  const created = [];
  try {
    for (const [path, code] of Object.entries(files)) {
      if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, code);
      created.push(path);
    }
    return check();
  } finally {
    for (const f of created) rmSync(f, { force: true });
    rmSync('src/app/__quality_probes__', { recursive: true, force: true });
  }
}

const duplicatedFn = (
  name,
) => `export function ${name}(values: readonly number[]): { min: number; max: number; mean: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let total = 0;
  for (const value of values) {
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
    total += value;
  }
  const mean = values.length === 0 ? 0 : total / values.length;
  const spread = max - min;
  const normalized = values.map((v) => (spread === 0 ? 0 : (v - min) / spread));
  const above = normalized.filter((v) => v > 0.5).length;
  const below = normalized.filter((v) => v <= 0.5).length;
  console.warn('stats', { above, below });
  return { min, max, mean };
}
`;

/** @type {{ name: string, run: () => { ok: boolean, detail: string } }[]} */
const PROBES = [
  // Q0.7 — duplication
  {
    name: 'jscpd fails on duplicated code',
    run: () =>
      withFiles(
        {
          'src/app/__quality_probes__/dup-a.ts': duplicatedFn('statsA'),
          'src/app/__quality_probes__/dup-b.ts': duplicatedFn('statsB'),
        },
        () => {
          const r = run('npx', [
            'jscpd',
            '-c',
            '.jscpd.json',
            '--reporters',
            'console',
            '--ignore',
            '**/*.spec.ts,**/node_modules/**',
          ]);
          return { ok: r.code !== 0 && /threshold|clone/i.test(r.out), detail: `exit=${r.code}` };
        },
      ),
  },
  {
    name: 'jscpd passes on the real codebase',
    run: () => {
      const r = run('npx', ['jscpd', '-c', '.jscpd.json', '--reporters', 'console']);
      return { ok: r.code === 0, detail: `exit=${r.code}` };
    },
  },
  // Q0.8 — dead code
  {
    name: 'knip fails on an unused file/export',
    run: () =>
      withFiles(
        {
          'src/app/__quality_probes__/dead.ts':
            'export function neverUsed(): number {\n  return 1;\n}\n',
        },
        () => {
          const r = run('npx', ['knip', '--no-progress']);
          return {
            ok: r.code !== 0 && /__quality_probes__\/dead\.ts/.test(r.out),
            detail: `exit=${r.code}`,
          };
        },
      ),
  },
  {
    name: 'knip passes on the real codebase',
    run: () => {
      const r = run('npx', ['knip', '--no-progress']);
      return { ok: r.code === 0, detail: `exit=${r.code}` };
    },
  },
];

let failed = 0;
for (const p of PROBES) {
  const { ok, detail } = p.run();
  if (!ok) failed++;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${p.name} (${detail})`);
}
console.log(
  failed
    ? `\n${failed} probe(s) failed`
    : `\nAll ${PROBES.length} quality probes behaved as expected`,
);
process.exit(failed ? 1 : 0);
