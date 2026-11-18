#!/usr/bin/env node
// Proves every quality lint rule actually fires (docs/QUALITY_GATES_PLAN.md Q0 gate).
// Writes deliberately bad probe files, lints them, asserts the expected rule ids, deletes them.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';

const DIR = 'src/app/__lint_probes__';

const branches = (n) =>
  Array.from({ length: n }, (_, i) => `  if (v === ${i}) { return ${i}; }`).join('\n');

/** @type {{ name: string, file: string, code: string, expect: string[] }[]} */
const PROBES = [
  // Q0.2 — type safety
  {
    name: 'explicit any',
    file: 'any.ts',
    code: 'export const x: any = 1;\n',
    expect: ['@typescript-eslint/no-explicit-any'],
  },
  // Q0.3 — complexity & size
  {
    name: 'cyclomatic complexity > 10',
    file: 'complexity.ts',
    code: `export function f(v: number): number {\n${branches(11)}\n  return -1;\n}\n`,
    expect: ['complexity'],
  },
  {
    name: 'cognitive complexity > 15',
    file: 'cognitive.ts',
    code: `export function g(a: number[], b: boolean, c: boolean): number {
  let s = 0;
  for (const x of a) {
    if (b) {
      for (const y of a) {
        if (c && x > y) { s += 1; } else if (x < y || b) { s -= 1; } else { s += 2; }
      }
    } else if (c) {
      while (s < x) { if (b || c) { s += 1; } }
    }
  }
  return s;
}
`,
    expect: ['sonarjs/cognitive-complexity'],
  },
  {
    name: 'too many params',
    file: 'params.ts',
    code: 'export function h(a: number, b: number, c: number, d: number, e: number): number {\n  return a + b + c + d + e;\n}\n',
    expect: ['max-params'],
  },
  {
    name: 'template cyclomatic complexity > 8',
    file: 'tpl-complexity.html',
    code: Array.from({ length: 9 }, (_, i) => `@if (v === ${i}) {<span>${i}</span>}`).join('\n') + '\n',
    expect: ['@angular-eslint/template/cyclomatic-complexity'],
  },
];

mkdirSync(DIR, { recursive: true });
let failed = 0;
try {
  for (const p of PROBES) writeFileSync(join(DIR, p.file), p.code);
  const eslint = new ESLint();
  const results = await eslint.lintFiles([`${DIR}/**/*`]);
  for (const p of PROBES) {
    const r = results.find((x) => x.filePath.endsWith(`${DIR}/${p.file}`));
    const fired = new Set((r?.messages ?? []).map((m) => m.ruleId ?? `parse:${m.message}`));
    const missing = p.expect.filter((id) => !fired.has(id));
    if (missing.length) {
      failed++;
      console.error(`FAIL  ${p.name}: missing [${missing.join(', ')}]; fired [${[...fired].join(', ')}]`);
    } else {
      console.log(`PASS  ${p.name}: ${p.expect.join(', ')}`);
    }
  }
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} probe(s) failed` : `\nAll ${PROBES.length} probes fired as expected`);
process.exit(failed ? 1 : 0);
