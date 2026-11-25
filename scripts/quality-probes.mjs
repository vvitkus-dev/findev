#!/usr/bin/env node
// Proves non-ESLint quality tools actually fail on bad input (specs/quality-gates).
// Each probe: create throwaway files → run the tool → assert exit code (and output) → clean up.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

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

/**
 * Copy the Rust crate (without target/) + toolchain file into a temp dir, append `code` to
 * lib.rs, run `cargo <args>` there, delete the copy. The real crate is never modified.
 */
function withRustCrate(code, args) {
  const dir = mkdtempSync(join(tmpdir(), 'rust-probe-'));
  try {
    cpSync('wasm/producer', dir, { recursive: true, filter: (src) => !src.includes('/target') });
    cpSync('rust-toolchain.toml', join(dir, 'rust-toolchain.toml'));
    // Insert before the test module so only the intended lint can fire (no items_after_test_module).
    const lib = join(dir, 'src/lib.rs');
    const src = readFileSync(lib, 'utf8');
    const at = src.indexOf('#[cfg(test)]');
    writeFileSync(
      lib,
      at === -1 ? `${src}\n${code}\n` : `${src.slice(0, at)}${code}\n\n${src.slice(at)}`,
    );
    const r = spawnSync('cargo', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: [process.env.PATH, join(homedir(), '.cargo', 'bin')].join(delimiter),
      },
    });
    return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
/** Builds a copy of the crate for wasm32 with one source edit, then runs verify-wasm on it. */
function verifyMutatedWasm(file, from, to) {
  const dir = mkdtempSync(join(tmpdir(), 'wasm-probe-'));
  try {
    cpSync('wasm/producer', dir, { recursive: true, filter: (src) => !src.includes('/target') });
    cpSync('rust-toolchain.toml', join(dir, 'rust-toolchain.toml'));
    const path = join(dir, file);
    const src = readFileSync(path, 'utf8');
    if (src.split(from).length !== 2) return { code: -1, out: `pattern not unique in ${file}` };
    writeFileSync(path, src.replace(from, to));
    const env = {
      ...process.env,
      PATH: [process.env.PATH, join(homedir(), '.cargo', 'bin')].join(delimiter),
    };
    const build = spawnSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown'], {
      cwd: dir,
      encoding: 'utf8',
      env,
    });
    if (build.status !== 0) return { code: -1, out: `build failed\n${build.stderr}` };
    const wasm = join(dir, 'target/wasm32-unknown-unknown/release/market_producer.wasm');
    return run('node', ['scripts/verify-wasm.mjs', wasm]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** verify-wasm must exit 1 and mention `expect` in its report. */
const wasmVerifyProbe = (name, expect, mutate) => ({
  name,
  run: () => {
    const r = mutate();
    return { ok: r.code === 1 && r.out.includes(expect), detail: `exit=${r.code} ${r.out.trim()}` };
  },
});

/** Runs deps-age on a throwaway package.json (+ optional lockfile) with a pinned "now". */
function depsAge(devDependencies, lockVersions, now) {
  const dir = mkdtempSync(join(tmpdir(), 'deps-probe-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ devDependencies }));
    if (lockVersions) {
      const packages = Object.fromEntries(
        Object.entries(lockVersions).map(([n, version]) => [`node_modules/${n}`, { version }]),
      );
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages }));
    }
    const r = spawnSync('node', ['scripts/deps-age.mjs', join(dir, 'package.json')], {
      encoding: 'utf8',
      env: { ...process.env, ...(now ? { DEPS_AGE_NOW: now } : {}) },
    });
    return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const depsProbe = (name, expectCode, expectText, args) => ({
  name,
  run: () => {
    const r = depsAge(...args);
    return {
      ok: r.code === expectCode && r.out.includes(expectText),
      detail: `exit=${r.code} ${r.out}`,
    };
  },
});

/** One exported function with `n` statements that no test calls (1 function, n + 1 statements). */
const uncoveredCode = (n) =>
  `export function probe(x: number): number {\n  let y = x;\n${'  y += 1;\n'.repeat(n)}  return y;\n}\n`;

const COVERAGE_METRICS = ['statements', 'lines'];
let baseline;
/**
 * Covered/total statements and lines, app-wide and under core/producer, from one clean
 * `test:ci` run (memoised). Probes size their untested code from this, so they keep breaking
 * exactly one floor however much the codebase grows.
 */
function coverageBaseline() {
  if (baseline) return baseline;
  const r = run('npm', ['run', '-s', 'test:ci']);
  if (r.code !== 0) throw new Error(`coverage baseline: test:ci failed (exit ${r.code})`);
  const summary = JSON.parse(readFileSync('coverage/findev/coverage-summary.json', 'utf8'));
  const sum = (keep) => {
    const t = Object.fromEntries(COVERAGE_METRICS.map((k) => [k, { covered: 0, total: 0 }]));
    for (const [file, m] of Object.entries(summary)) {
      if (file === 'total' || !keep(file)) continue;
      for (const k of COVERAGE_METRICS) {
        t[k].covered += m[k].covered;
        t[k].total += m[k].total;
      }
    }
    return t;
  };
  baseline = { all: sum(() => true), core: sum((f) => f.includes('/src/app/core/producer/')) };
  return baseline;
}

/** Uncovered statements that push `scope` to `pct` % (the probe file adds about n + 2). */
const statementsToReach = (scope, pct) =>
  Math.max(...COVERAGE_METRICS.map((k) => scope[k].covered / (pct / 100) - scope[k].total));

/** Break core/producer (85 %) with margin (aim 80 %) while global stays above 65 % (aim 70 %). */
const coreOnlySize = (b) => {
  const lo = statementsToReach(b.core, 80);
  const hi = Math.min(...COVERAGE_METRICS.map((k) => b.all[k].covered / 0.7 - b.all[k].total));
  if (lo >= hi) throw new Error(`coverage probe cannot isolate the core floor (need ${lo}..${hi})`);
  return Math.ceil((lo + hi) / 2);
};

/** Break the 65 % global floor (aim 55 %); outside core, so core/producer is untouched. */
const globalOnlySize = (b) => Math.ceil(statementsToReach(b.all, 55));

/**
 * Runs `npm run test:ci` with one extra untested file. Passes when the run fails with a
 * threshold message mentioning `expect` and no threshold message mentioning `forbid`.
 */
const coverageProbe = (name, file, size, expect, forbid) => ({
  name,
  run: () => {
    const statements = size(coverageBaseline());
    const r = withFiles({ [file]: uncoveredCode(statements) }, () =>
      run('npm', ['run', '-s', 'test:ci']),
    );
    // eslint-disable-next-line no-control-regex -- strip ANSI colour codes from the runner output
    const out = r.out.replace(/\x1b\[[0-9;]*m/g, '');
    const misses = out
      .split('\n')
      .filter((l) => l.includes('does not meet'))
      .map((l) => l.trim());
    const ok =
      r.code !== 0 &&
      misses.some((l) => l.includes(expect)) &&
      !misses.some((l) => l.includes(forbid));
    return {
      ok,
      detail: `n=${statements} exit=${r.code}\n        ${misses.join('\n        ') || '(no threshold message)'}`,
    };
  },
});

/** The gate's own flags, read from package.json so the probe always tests the real thresholds. */
const covRustArgs = () => {
  const script = JSON.parse(readFileSync('package.json', 'utf8')).scripts['cov:rust'];
  const gate = script.split('&&')[0].trim().split(/\s+/);
  return gate.slice(gate.indexOf('llvm-cov'));
};
/** 20 public functions no test calls: functions coverage drops well below 85 %. */
const uncoveredRust = Array.from(
  { length: 20 },
  (_, i) =>
    `/// Probe.\n#[must_use]\npub fn uncovered_${i}(x: u32) -> u32 {\n    x.wrapping_add(${i})\n}\n`,
).join('\n');

const CLIPPY = ['clippy', '--all-targets', '--message-format', 'json', '--', '-D', 'warnings'];
/** Lint codes (e.g. `clippy::unwrap_used`) reported in cargo's JSON message stream. */
const lintCodes = (out) =>
  new Set(
    out
      .split('\n')
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l).message?.code?.code)
      .filter(Boolean),
  );
/** Probe: appending `code` must make clippy fail with lint `lint`. */
const clippyProbe = (name, lint, code) => ({
  name,
  run: () => {
    const r = withRustCrate(code, CLIPPY);
    const codes = lintCodes(r.out);
    return {
      ok: r.code !== 0 && codes.has(`clippy::${lint}`),
      detail: `exit=${r.code} lints=[${[...codes].join(', ')}]`,
    };
  },
});

/** Lines jscpd measures today (non-spec .ts/.html/.scss under src). */
function sourceLines(dir = 'src') {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) n += sourceLines(path);
    else if (/\.(ts|html|scss)$/.test(e.name) && !e.name.endsWith('.spec.ts')) {
      n += readFileSync(path, 'utf8').split('\n').length;
    }
  }
  return n;
}

/** Extra body lines so the copied block stays ≈ 10 % of the code (threshold 3 %) as it grows. */
const padding = (lines) =>
  Array.from({ length: lines }, (_, i) => `  total = (total * 31 + ${i}) % 1_000_003;\n`).join('');

const duplicatedFn = (
  name,
  extra = 0,
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
${padding(extra)}  const mean = values.length === 0 ? 0 : total / values.length;
  const spread = max - min;
  const normalized = values.map((v) => (spread === 0 ? 0 : (v - min) / spread));
  const above = normalized.filter((v) => v > 0.5).length;
  const below = normalized.filter((v) => v <= 0.5).length;
  console.warn('stats', { above, below });
  return { min, max, mean };
}
`;

let dupLines;
const dupPadding = () => (dupLines ??= Math.ceil(sourceLines() * 0.05));

/** @type {{ name: string, run: () => { ok: boolean, detail: string } }[]} */
// A static server for the smoke probes: serves `dir` under /findev/ (like GitHub Pages), with
// real content types and 404.html as the not-found page, then runs smoke-deploy against it.
const SMOKE_SERVER = `
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const [dir, ...extra] = process.argv.slice(1);
const TYPES = { wasm: 'application/wasm', js: 'text/javascript', html: 'text/html' };
const server = createServer(async (req, res) => {
  const path = req.url.replace(/^\\/findev\\//, '').split('?')[0] || 'index.html';
  const send = (status, file) =>
    readFile(join(dir, file)).then((body) => {
      res.writeHead(status, { 'content-type': TYPES[file.split('.').pop()] ?? 'text/plain' });
      res.end(body);
    });
  await send(200, path)
    .catch(() => send(200, path + '.html'))
    .catch(() => send(404, '404.html'))
    .catch(() => {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
});
server.listen(0, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/findev/';
  spawn('node', ['scripts/smoke-deploy.mjs', url, ...extra], { stdio: 'inherit' }).on('exit', (code) => {
    server.close();
    process.exit(code ?? 1);
  });
});
`;
const SHELL =
  '<!doctype html><app-root></app-root><script src="main-ABC.js" type="module"></script>';
const GOOD_DEPLOY = {
  'index.html': SHELL,
  'dashboard.html': SHELL,
  'settings.html': SHELL,
  '404.html': SHELL,
  'main-ABC.js': 'const BUILD = "abc1234";',
  'wasm/producer.wasm': '\0asm\x01\0\0\0',
};

/** smoke-deploy against a fake deploy (`GOOD_DEPLOY` with `changes`; null deletes a file). */
const smokeProbe = (name, expectCode, expectText, changes, extraArgs = []) => ({
  name,
  run: () => {
    const dir = mkdtempSync(join(tmpdir(), 'smoke-probe-'));
    try {
      for (const [file, body] of Object.entries({ ...GOOD_DEPLOY, ...changes })) {
        if (body === null) continue;
        mkdirSync(dirname(join(dir, file)), { recursive: true });
        writeFileSync(join(dir, file), body);
      }
      const r = run('node', ['--input-type=module', '-e', SMOKE_SERVER, dir, ...extraArgs]);
      return {
        ok: r.code === expectCode && r.out.includes(expectText),
        detail: `exit=${r.code}${r.code === expectCode ? '' : `\n${r.out}`}`,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

/** test-pyramid on a fake counts file: expects `expectCode` and `expectText` in the output. */
const pyramidProbe = (name, counts, expectCode, expectText) => ({
  name,
  run: () => {
    const dir = mkdtempSync(join(tmpdir(), 'pyramid-probe-'));
    try {
      const file = join(dir, 'counts.json');
      writeFileSync(file, JSON.stringify(counts));
      const r = spawnSync('node', ['scripts/test-pyramid.mjs', '--counts', file], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: '' },
      });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      const ok = r.status === expectCode && out.includes(expectText);
      return { ok, detail: `exit=${String(r.status)}${ok ? '' : `\n${out}`}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

/** pr-size in a throwaway git repo: one base commit, then `files` ({path: lineCount}) on HEAD. */
const prSizeProbe = (name, files, expectCode, expectText) => ({
  name,
  run: () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-size-probe-'));
    const git = (...args) =>
      spawnSync(
        'git',
        ['-c', 'user.name=probe', '-c', 'user.email=probe@example.invalid', ...args],
        {
          cwd: dir,
          encoding: 'utf8',
        },
      );
    try {
      git('init', '-q', '-b', 'main');
      writeFileSync(join(dir, 'README.md'), 'base\n');
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      git('checkout', '-q', '-b', 'feature');
      for (const [path, lines] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), 'x\n'.repeat(lines));
      }
      git('add', '.');
      git('commit', '-q', '-m', 'change');
      const r = spawnSync('node', [join(process.cwd(), 'scripts/pr-size.mjs'), 'main'], {
        cwd: dir,
        encoding: 'utf8',
      });
      const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
      const ok = r.status === expectCode && out.includes(expectText);
      return { ok, detail: `exit=${String(r.status)}${ok ? '' : `\n${out}`}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});

const PROBES = [
  // Q0.7 — duplication
  {
    name: 'jscpd fails on duplicated code',
    run: () =>
      withFiles(
        {
          'src/app/__quality_probes__/dup-a.ts': duplicatedFn('statsA', dupPadding()),
          'src/app/__quality_probes__/dup-b.ts': duplicatedFn('statsB', dupPadding()),
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
  // Q0.9 — Rust static analysis (each runs on a throwaway copy of the crate)
  clippyProbe(
    'clippy pedantic: lossy cast',
    'cast_possible_truncation',
    '/// Probe.\n#[must_use]\npub fn narrow(x: u64) -> u32 { x as u32 }',
  ),
  clippyProbe(
    'clippy: unwrap banned outside tests',
    'unwrap_used',
    '/// Probe.\n#[must_use]\npub fn first(v: &[u32]) -> u32 { *v.first().unwrap() }',
  ),
  clippyProbe(
    'clippy: more than 4 arguments',
    'too_many_arguments',
    '/// Probe.\n#[must_use]\npub fn five(a: u32, b: u32, c: u32, d: u32, e: u32) -> u32 { a ^ b ^ c ^ d ^ e }',
  ),
  clippyProbe(
    'clippy: cognitive complexity > 7',
    'cognitive_complexity',
    `/// Probe.
#[must_use]
pub fn tangled(v: &[u32], a: bool, b: bool) -> u32 {
    let mut s = 0;
    for x in v {
        if a {
            for y in v {
                if b && x > y { s += 1; } else if x < y || a { s += 2; } else { s += 3; }
            }
        } else if b {
            while s < *x { if a || b { s += 1; } else { s += 2; } }
        }
    }
    s
}`,
  ),
  clippyProbe(
    'clippy: nesting deeper than 4 blocks',
    'excessive_nesting',
    `/// Probe.
#[must_use]
pub fn deep(v: &[u32]) -> u32 {
    let mut s = 0;
    for x in v {
        for y in v {
            for z in v {
                if x + y > *z {
                    s += 1;
                }
            }
        }
    }
    s
}`,
  ),
  {
    name: 'rustfmt --check fails on unformatted code',
    run: () => {
      const r = withRustCrate('/// Probe.\npub   fn   ugly( )->u32{1}', ['fmt', '--check']);
      return { ok: r.code !== 0, detail: `exit=${r.code}` };
    },
  },
  {
    name: 'ALLOWED: unchanged crate passes clippy -D warnings',
    run: () => {
      const r = withRustCrate('', CLIPPY);
      return { ok: r.code === 0, detail: `exit=${r.code}${r.code === 0 ? '' : `\n${r.out}`}` };
    },
  },
  // verify-wasm (Implementation step 1.6): the ABI check must reject wrong modules.
  wasmVerifyProbe('verify-wasm rejects a module without the ABI exports', 'exports mismatch', () =>
    withFiles({ 'src/app/__quality_probes__/empty.wasm': '\0asm\x01\0\0\0' }, () =>
      run('node', ['scripts/verify-wasm.mjs', 'src/app/__quality_probes__/empty.wasm']),
    ),
  ),
  wasmVerifyProbe('verify-wasm rejects a bumped ABI version', 'abi_version() = 2', () =>
    verifyMutatedWasm(
      'src/abi.rs',
      'pub const ABI_VERSION: u32 = 1;',
      'pub const ABI_VERSION: u32 = 2;',
    ),
  ),
  wasmVerifyProbe('verify-wasm rejects records that break an invariant', 'trade qty < 1', () =>
    verifyMutatedWasm(
      'src/model.rs',
      'trade_qty: 1 + rng.below(MAX_TRADE_QTY),',
      'trade_qty: rng.below(MAX_TRADE_QTY),',
    ),
  ),
  // smoke-deploy (Implementation step 8.4/8.5): the post-deploy check must catch a broken deploy.
  smokeProbe('smoke-deploy fails when the wasm is missing', 1, 'FAIL  wasm is served', {
    'wasm/producer.wasm': null,
  }),
  smokeProbe('smoke-deploy fails without the SPA 404.html fallback', 1, 'FAIL  unknown URL', {
    '404.html': null,
  }),
  smokeProbe(
    'smoke-deploy fails when a route has no page of its own (deep link answers 404)',
    1,
    'FAIL  deep link /settings',
    { 'settings.html': null },
  ),
  smokeProbe(
    'smoke-deploy fails when the live bundle is an older build',
    1,
    'does not contain def5678',
    {},
    ['--sha', 'def5678'],
  ),
  smokeProbe('ALLOWED: smoke-deploy passes a complete deploy of the expected build', 0, 'OK', {}, [
    '--sha',
    'abc1234',
  ]),
  // deps:age — supply-chain gate (vitest 5.1.0 was published 2026-11-02).
  depsProbe('deps:age rejects a version range', 1, 'is not an exact version', [
    { vitest: '^5.0.0' },
  ]),
  depsProbe('deps:age rejects a release younger than 14 days', 1, 'published 3.', [
    { vitest: '5.1.0' },
    null,
    '2026-11-05T16:00:00Z',
  ]),
  depsProbe(
    'deps:age rejects a lockfile that drifted from the pin',
    1,
    'package-lock resolves 5.1.1',
    [{ vitest: '5.1.0' }, { vitest: '5.1.1' }],
  ),
  depsProbe('ALLOWED: deps:age accepts an old exact pin matching the lockfile', 0, 'OK deps:age', [
    { vitest: '5.1.0' },
    { vitest: '5.1.0' },
    '2026-11-17T00:00:00Z',
  ]),
  {
    name: 'cov:rust fails when Rust functions go untested',
    run: () => {
      // A threshold miss prints the summary table and exits 1 (a compile error would exit 101).
      const r = withRustCrate(uncoveredRust, covRustArgs());
      const total = r.out.split('\n').find((l) => l.startsWith('TOTAL')) ?? '';
      const pcts = total.match(/\d+\.\d+%/g) ?? [];
      return {
        ok: r.code === 1 && total !== '',
        detail: `exit=${r.code} regions/functions/lines = ${pcts.join(' / ') || '(no summary)'}`,
      };
    },
  },
  {
    name: 'ALLOWED: cov:rust passes on the unchanged crate',
    run: () => {
      const r = withRustCrate('', covRustArgs());
      return { ok: r.code === 0, detail: `exit=${r.code}` };
    },
  },
  // Coverage gates (Q2.1 global 65 %, Q2.2 critical paths 85 %). Untested files must count.
  // Each probe is sized from a clean baseline run so exactly ONE floor breaks at any codebase size.
  coverageProbe(
    'coverage: untested core/producer code breaks only the 85 % critical-path floor',
    'src/app/core/producer/__quality_probe_uncovered.ts',
    coreOnlySize,
    'src/app/core/producer/**',
    'global threshold',
  ),
  coverageProbe(
    'coverage: untested code elsewhere breaks only the 65 % global floor',
    'src/app/__quality_probes__/uncovered.ts',
    globalOnlySize,
    'global threshold',
    'src/app/core/producer/**',
  ),
  // Q4.1 — testing pyramid (fake counts; the real collection runs in test:pyramid)
  pyramidProbe(
    'pyramid fails on an ice-cream cone (50 % E2E)',
    { unit: 40, integration: 10, e2e: 50 },
    1,
    'ice-cream cone detected',
  ),
  pyramidProbe(
    'pyramid fails when unit tests drop below 60 %',
    { unit: 50, integration: 45, e2e: 5 },
    1,
    'unit tests are 50.0 %',
  ),
  pyramidProbe(
    'pyramid fails with fewer than 3 integration tests',
    { unit: 95, integration: 2, e2e: 3 },
    1,
    'only 2 integration tests',
  ),
  pyramidProbe(
    'ALLOWED: a healthy pyramid passes',
    { unit: 90, integration: 5, e2e: 5 },
    0,
    'Pyramid OK.',
  ),
  // Q4.3 — PR size
  prSizeProbe('pr-size fails on a 601-line PR', { 'src/big.ts': 601 }, 1, 'split the PR'),
  prSizeProbe(
    'ALLOWED: pr-size ignores the lockfile, screenshots and vendored skills',
    {
      'src/small.ts': 100,
      'package-lock.json': 5000,
      'e2e/__screenshots__/a.txt': 900,
      '.claude/skills/x/SKILL.md': 900,
    },
    0,
    '100 changed lines',
  ),
  // Q5.1 — mutation testing: with only the formatter specs, every metrics mutant survives
  {
    name: 'stryker fails when the mutation score drops below 80 %',
    run: () =>
      withFiles(
        {
          'stryker/__probe.vitest.config.mts': `import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { globals: true, environment: 'node', include: ['src/app/shared/format/market-format.spec.ts'] },
});
`,
          '__probe.stryker.config.mjs': `import base from './stryker.config.mjs';
export default {
  ...base,
  vitest: { configFile: 'stryker/__probe.vitest.config.mts' },
  reporters: ['clear-text'],
  tempDirName: '.stryker-tmp-probe',
};
`,
        },
        () => {
          const r = run('npx', ['stryker', 'run', '__probe.stryker.config.mjs']);
          rmSync('.stryker-tmp-probe', { recursive: true, force: true });
          return {
            ok: r.code !== 0 && r.out.includes('under breaking threshold 80'),
            detail: `exit=${r.code}${r.code !== 0 ? '' : `\n${r.out.slice(-2000)}`}`,
          };
        },
      ),
  },
];

// Optional filter: `node scripts/quality-probes.mjs smoke-deploy` runs only matching probes.
const only = process.argv[2];
const selected = PROBES.filter((p) => !only || p.name.includes(only));
let failed = 0;
for (const p of selected) {
  const { ok, detail } = p.run();
  if (!ok) failed++;
  console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${p.name} (${detail})`);
}
console.log(
  failed
    ? `\n${failed} probe(s) failed`
    : `\nAll ${selected.length} quality probes behaved as expected`,
);
process.exit(failed ? 1 : 0);
