#!/usr/bin/env node
// Proves every quality lint rule actually fires (docs/QUALITY_GATES_PLAN.md Q0 gate).
// Writes deliberately bad probe files, lints them, asserts the expected rule ids, deletes them.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ESLint } from 'eslint';

// Probe paths are relative to src/app. Default location is a throwaway folder; boundary
// probes are placed inside real architecture folders (files are always prefixed `__probe`).
const ROOT = 'src/app';
const P = '__lint_probes__/';

const branches = (n) =>
  Array.from({ length: n }, (_, i) => `  if (v === ${i}) { return ${i}; }`).join('\n');

/** `expect`: rule ids that MUST fire. `forbid`: rule ids that must NOT fire (false-positive guard). */
/** @type {{ name: string, file: string, code: string, expect: string[], forbid?: string[] }[]} */
const PROBES = [
  // Q0.2 — type safety
  {
    name: 'explicit any',
    file: P + 'any.ts',
    code: 'export const x: any = 1;\n',
    expect: ['@typescript-eslint/no-explicit-any'],
  },
  // Q0.3 — complexity & size
  {
    name: 'cyclomatic complexity > 10',
    file: P + 'complexity.ts',
    code: `export function f(v: number): number {\n${branches(11)}\n  return -1;\n}\n`,
    expect: ['complexity'],
  },
  {
    name: 'cognitive complexity > 15',
    file: P + 'cognitive.ts',
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
    file: P + 'params.ts',
    code: 'export function h(a: number, b: number, c: number, d: number, e: number): number {\n  return a + b + c + d + e;\n}\n',
    expect: ['max-params'],
  },
  {
    name: 'template cyclomatic complexity > 8',
    file: P + 'tpl-complexity.html',
    code:
      Array.from({ length: 9 }, (_, i) => `@if (v === ${i}) {<span>${i}</span>}`).join('\n') + '\n',
    expect: ['@angular-eslint/template/cyclomatic-complexity'],
  },
  // Q0.4 — architecture boundaries & API bans
  {
    name: 'engine must be framework-free',
    file: 'core/producer/engine/__probe.ts',
    code: "import { signal } from '@angular/core';\nexport const s = signal(1);\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'core must not import features',
    file: 'core/__probe.ts',
    code: "import '../features/dashboard/dashboard';\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'shared must not import core',
    file: 'shared/__probe.ts',
    code: "import '../core/producer/producer-store';\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'shared must not import core via a deeper relative path',
    file: 'shared/format/__probe.ts',
    code: "import '../../core/producer/engine/metrics';\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'feature must not import another feature',
    file: 'features/dashboard/__probe.ts',
    code: "import '../settings/settings';\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'Reactive Forms banned (Signal Forms only)',
    file: P + 'forms.ts',
    code: "import { FormControl } from '@angular/forms';\nexport const c = new FormControl(1);\n",
    expect: ['no-restricted-imports'],
  },
  {
    name: 'Math.random banned in core',
    file: 'core/__probe_random.ts',
    code: 'export const r = Math.random();\n',
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'new Worker banned outside WORKER_FACTORY (one worker per app)',
    file: 'features/dashboard/__probe_worker.ts',
    code: "export const w = new Worker(new URL('./x.worker', import.meta.url));\n",
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'new Worker banned in core outside producer-tokens.ts',
    file: 'core/producer/__probe_worker.ts',
    code: "export const w = new Worker('x.js');\n",
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'Signal Forms: min/max attribute on a [formField] input banned',
    file: P + 'ff-min.ts',
    code: 'import { Component } from \'@angular/core\';\nimport { FormField } from \'@angular/forms/signals\';\n@Component({ selector: \'app-p\', imports: [FormField], template: `<input type="number" min="1" [formField]="f" />` })\nexport class P {}\n',
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'Signal Forms: [disabled] on a [formField] input banned',
    file: P + 'ff-disabled.ts',
    code: "import { Component } from '@angular/core';\nimport { FormField } from '@angular/forms/signals';\n@Component({ selector: 'app-p', imports: [FormField], template: `<input [disabled]=\"d\" [formField]=\"f\" />` })\nexport class P {}\n",
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'Signal Forms: [value] on a [formField] input banned',
    file: P + 'ff-value.ts',
    code: "import { Component } from '@angular/core';\nimport { FormField } from '@angular/forms/signals';\n@Component({ selector: 'app-p', imports: [FormField], template: `<input [value]=\"v\" [formField]=\"f\" />` })\nexport class P {}\n",
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'ALLOWED: static value on a radio [formField] and [disabled] on a button',
    file: P + 'ff-ok.ts',
    code: 'import { Component } from \'@angular/core\';\nimport { FormField } from \'@angular/forms/signals\';\n@Component({ selector: \'app-p\', imports: [FormField], template: `<input type="radio" value="a" [formField]="f" /><button type="button" [disabled]="d">x</button>` })\nexport class P {}\n',
    expect: [],
    forbid: ['no-restricted-syntax'],
  },
  {
    name: '@Injectable banned (use @Service)',
    file: P + 'injectable.ts',
    code: "import { Injectable } from '@angular/core';\n@Injectable({ providedIn: 'root' })\nexport class Svc {}\n",
    expect: ['no-restricted-syntax'],
  },
  {
    name: 'fixture.detectChanges banned in specs',
    file: P + 'cd.spec.ts',
    code: "declare const fixture: { detectChanges(): void };\nit('x', () => {\n  fixture.detectChanges();\n  expect(1).toBe(1);\n});\n",
    expect: ['no-restricted-syntax'],
  },
  // Q0.5 — test hygiene
  {
    name: 'focused test (it.only) banned',
    file: P + 'only.spec.ts',
    code: "describe('d', () => {\n  it.only('x', () => {\n    expect(1).toBe(1);\n  });\n});\n",
    expect: ['vitest/no-focused-tests'],
  },
  {
    name: 'skipped test banned',
    file: P + 'skip.spec.ts',
    code: "describe('d', () => {\n  it.skip('x', () => {\n    expect(1).toBe(1);\n  });\n});\n",
    expect: ['vitest/no-disabled-tests'],
  },
  {
    name: 'test without assertion',
    file: P + 'noexpect.spec.ts',
    code: "describe('d', () => {\n  it('x', () => {\n    const a = 1;\n    void a;\n  });\n});\n",
    expect: ['vitest/expect-expect'],
  },
  {
    name: 'conditional logic in test',
    file: P + 'cond.spec.ts',
    code: "describe('d', () => {\n  it('x', () => {\n    const v = Number('1');\n    if (v > 0) {\n      expect(v).toBe(1);\n    }\n  });\n});\n",
    expect: ['vitest/no-conditional-in-test'],
  },
  // Q0.6 — AAA sections
  {
    name: 'test without AAA sections',
    file: P + 'aaa.spec.ts',
    code: "describe('d', () => {\n  it('x', () => {\n    expect(1).toBe(1);\n  });\n});\n",
    expect: ['local/aaa-sections'],
  },
  // Q1.5 — suppression discipline
  {
    name: 'eslint-disable without a reason',
    file: P + 'disable-noreason.ts',
    code: '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nexport const x: any = 1;\n',
    expect: ['@eslint-community/eslint-comments/require-description'],
  },
  {
    name: 'blanket eslint-disable banned',
    file: P + 'disable-all.ts',
    code: '/* eslint-disable -- whatever */\nexport const x = 1;\n',
    expect: ['@eslint-community/eslint-comments/no-unlimited-disable'],
  },
  {
    name: 'architecture rules cannot be disabled',
    file: 'core/__probe_disable.ts',
    code: '// eslint-disable-next-line no-restricted-syntax -- I really want it\nexport const r = Math.random();\n',
    expect: ['@eslint-community/eslint-comments/no-restricted-disable'],
  },
  {
    name: 'ALLOWED: justified disable of a normal rule',
    file: P + 'disable-ok.ts',
    code: '// eslint-disable-next-line @typescript-eslint/no-explicit-any -- third-party typing gap\nexport const x: any = 1;\n',
    expect: [],
    forbid: [
      '@eslint-community/eslint-comments/require-description',
      '@typescript-eslint/no-explicit-any',
    ],
  },
  {
    name: 'empty undecorated class still banned',
    file: P + 'empty-class.ts',
    code: 'export class Nothing {}\n',
    expect: ['@typescript-eslint/no-extraneous-class'],
  },
  // Negative probes — legitimate code must stay clean (no false positives)
  {
    name: 'ALLOWED: feature imports its own subfolder and core',
    file: 'features/dashboard/components/__probe_ok.ts',
    code: "import '../models/row';\nimport '../../../core/producer/producer-store';\nimport '../dashboard';\n",
    expect: [],
    forbid: ['no-restricted-imports'],
  },
  {
    name: 'ALLOWED: shared imports @angular/core and its own folder',
    file: 'shared/format/__probe_ok.ts',
    code: "import { Pipe } from '@angular/core';\nimport { TestBed } from '@angular/core/testing';\nimport '../format/market-format';\nimport './market-format';\nexport const x = [Pipe, TestBed];\n",
    expect: [],
    forbid: ['no-restricted-imports'],
  },
  {
    name: 'ALLOWED: core imports @angular/core (only engine/ is framework-free)',
    file: 'core/producer/__probe_ok.ts',
    code: "import { signal } from '@angular/core';\nexport const s = signal(0);\n",
    expect: [],
    forbid: ['no-restricted-imports'],
  },
  {
    name: 'ALLOWED: empty decorated Angular component class',
    file: P + 'empty-component.ts',
    code: "import { Component } from '@angular/core';\n@Component({ selector: 'app-x', template: '' })\nexport class X {}\n",
    expect: [],
    forbid: ['@typescript-eslint/no-extraneous-class'],
  },
  {
    name: 'ALLOWED: Signal Forms import',
    file: P + 'signal-forms.ts',
    code: "import { form } from '@angular/forms/signals';\nexport const f = form;\n",
    expect: [],
    forbid: ['no-restricted-imports'],
  },
];

// Create probes, remembering which directories we created so cleanup never touches real code.
const createdDirs = [];
const createdFiles = [];
const ensureDir = (dir) => {
  if (existsSync(dir)) return;
  ensureDir(dirname(dir));
  mkdirSync(dir);
  createdDirs.push(dir);
};
let failed = 0;
try {
  for (const p of PROBES) {
    const path = join(ROOT, p.file);
    if (existsSync(path)) throw new Error(`Refusing to overwrite existing file ${path}`);
    ensureDir(dirname(path));
    writeFileSync(path, p.code);
    createdFiles.push(path);
  }
  const eslint = new ESLint();
  const results = await eslint.lintFiles(createdFiles);
  for (const p of PROBES) {
    const r = results.find((x) => x.filePath === resolve(ROOT, p.file));
    const fired = new Set((r?.messages ?? []).map((m) => m.ruleId ?? `parse:${m.message}`));
    const missing = p.expect.filter((id) => !fired.has(id));
    const unexpected = (p.forbid ?? []).filter((id) => fired.has(id));
    if (missing.length || unexpected.length) {
      failed++;
      console.error(
        `FAIL  ${p.name}: missing [${missing.join(', ')}] unexpected [${unexpected.join(', ')}]; fired [${[...fired].join(', ')}]`,
      );
    } else {
      console.log(`PASS  ${p.name}: ${p.expect.join(', ') || `no ${(p.forbid ?? []).join(', ')}`}`);
    }
  }
} finally {
  for (const f of createdFiles) rmSync(f, { force: true });
  for (const d of createdDirs.reverse()) rmSync(d, { recursive: true, force: true });
}
console.log(
  failed ? `\n${failed} probe(s) failed` : `\nAll ${PROBES.length} probes fired as expected`,
);
process.exit(failed ? 1 : 0);
