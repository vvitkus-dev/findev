#!/usr/bin/env node
// Proves non-ESLint quality tools actually fail on bad input (docs/QUALITY_GATES_PLAN.md).
// Each probe: create throwaway files → run the tool → assert exit code (and output) → clean up.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
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
