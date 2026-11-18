#!/usr/bin/env node
// Mutation check for the Rust producer: proves the tests actually catch bugs.
// Each mutant applies one realistic defect to a temporary copy of the crate; `cargo test`
// MUST fail ("killed"). A surviving mutant means a missing/weak test. The real crate is untouched.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

/** @type {{ name: string, file: string, from: string, to: string }[]} */
const MUTANTS = [
  // Step 1.2 — rng.rs
  {
    name: 'PCG32 rotation uses wrong bits',
    file: 'src/rng.rs',
    from: 'let rot = high32(old) >> 27;',
    to: 'let rot = high32(old) >> 28;',
  },
  {
    name: 'PCG32 output skips the xorshift',
    file: 'src/rng.rs',
    from: 'low32(((old >> 18) ^ old) >> 27)',
    to: 'low32(old >> 27)',
  },
  {
    name: 'SplitMix64 drops a mixing round',
    file: 'src/rng.rs',
    from: 'z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);',
    to: '',
  },
  {
    name: 'from_seed ignores the seed',
    file: 'src/rng.rs',
    from: 'let mut sm = seed;',
    to: 'let mut sm = seed & 0;',
  },
  {
    name: 'below() only covers half the range',
    file: 'src/rng.rs',
    from: '        high32(m)\n',
    to: '        high32(m) / 2\n',
  },
  {
    name: 'below(0) no longer guarded',
    file: 'src/rng.rs',
    from: '        if bound == 0 {\n            return 0;\n        }',
    to: '        if bound == 0 {\n            return 1;\n        }',
  },
  {
    name: 'unit_f64 scaled wrongly (escapes [0,1))',
    file: 'src/rng.rs',
    from: 'a.mul_add(TWO_POW_26, b) / TWO_POW_53',
    to: 'a.mul_add(TWO_POW_26, b) / TWO_POW_26',
  },
  // Step 1.3 — model.rs
  {
    name: 'mid floor removed (price can reach 0)',
    file: 'src/model.rs',
    from: 'let bounds = (MIN_MID_CENTS, MAX_MID_CENTS);',
    to: 'let bounds = (0, MAX_MID_CENTS);',
  },
  {
    name: 'spread may collapse to 0 (bid == ask)',
    file: 'src/model.rs',
    from: '            (1, Self::spread_cap(self.mid_cents)),',
    to: '            (0, Self::spread_cap(self.mid_cents)),',
  },
  {
    name: 'sell trades execute at mid instead of bid',
    file: 'src/model.rs',
    from: 'price_cents: if buy { ask_cents } else { bid_cents },',
    to: 'price_cents: if buy { ask_cents } else { self.mid_cents },',
  },
  {
    name: 'bid book quantity unbounded',
    file: 'src/model.rs',
    from: 'self.bid_qty = walk(rng, self.bid_qty, BOOK_STEP, (0, MAX_BOOK_QTY));',
    to: 'self.bid_qty = walk(rng, self.bid_qty, BOOK_STEP, (0, u32::MAX));',
  },
  {
    name: 'trade quantity can be 0',
    file: 'src/model.rs',
    from: 'trade_qty: 1 + rng.below(MAX_TRADE_QTY),',
    to: 'trade_qty: rng.below(MAX_TRADE_QTY),',
  },
  {
    name: 'imbalance sign inverted',
    file: 'src/model.rs',
    from: '0.25f64.mul_add((b - a) / total, 0.5)',
    to: '0.25f64.mul_add((a - b) / total, 0.5)',
  },
  {
    name: 'mid jumps instead of evolving from previous value',
    file: 'src/model.rs',
    from: '            self.mid_cents,\n            Self::max_mid_step(self.mid_cents),',
    to: '            self.mid_cents,\n            Self::max_mid_step(self.mid_cents) * 4,',
  },
  {
    name: 'every trade is a buy',
    file: 'src/model.rs',
    from: 'let buy = rng.unit_f64() < buy_probability(self.bid_qty, self.ask_qty);',
    to: 'let buy = rng.unit_f64() < 2.0;',
  },
];

const env = {
  ...process.env,
  PATH: [process.env.PATH, join(homedir(), '.cargo', 'bin')].join(delimiter),
};
const only = process.argv[2]; // optional substring filter
let survived = 0;
let run = 0;

for (const m of MUTANTS.filter((x) => !only || x.name.includes(only))) {
  const dir = mkdtempSync(join(tmpdir(), 'rust-mutant-'));
  try {
    cpSync('wasm/producer', dir, { recursive: true, filter: (src) => !src.includes('/target') });
    cpSync('rust-toolchain.toml', join(dir, 'rust-toolchain.toml'));
    const path = join(dir, m.file);
    const src = readFileSync(path, 'utf8');
    if (src.split(m.from).length !== 2) {
      console.error(
        `ERROR ${m.name}: pattern must occur exactly once in ${m.file} (stale mutant?)`,
      );
      survived++;
      continue;
    }
    writeFileSync(path, src.replace(m.from, m.to));
    run++;
    const r = spawnSync('cargo', ['test'], { cwd: dir, encoding: 'utf8', env });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    // Only a failing *test* counts. A compile error would "fail" without any test catching it.
    if (/error(\[E\d+\])?: /.test(out) && !out.includes('test result:')) {
      console.error(`INVALID  ${m.name}: mutant does not compile — rewrite it`);
      survived++;
      continue;
    }
    const killed = out.includes('test result: FAILED');
    if (!killed) survived++;
    const failing = [...out.matchAll(/^test (\S+) \.\.\. FAILED/gm)].map((x) => x[1]).join(', ');
    console[killed ? 'log' : 'error'](
      `${killed ? 'KILLED  ' : 'SURVIVED'} ${m.name}${failing ? ` ← ${failing}` : ''}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(
  survived
    ? `\n${survived} mutant(s) survived — add or strengthen tests`
    : `\nAll ${run} mutants killed`,
);
process.exit(survived ? 1 : 0);
