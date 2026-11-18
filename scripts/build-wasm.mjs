#!/usr/bin/env node
// Builds the Rust producer for wasm32 (release) and copies it to public/wasm/producer.wasm,
// where Angular serves it as a static asset. Run `npm run wasm:verify` afterwards.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

const SOURCE = 'wasm/producer/target/wasm32-unknown-unknown/release/market_producer.wasm';
const TARGET = 'public/wasm/producer.wasm';

const r = spawnSync(
  process.execPath,
  ['scripts/cargo.mjs', 'build', '--release', '--target', 'wasm32-unknown-unknown'],
  { stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status ?? 1);

mkdirSync('public/wasm', { recursive: true });
copyFileSync(SOURCE, TARGET);
console.log(`built ${TARGET} (${statSync(TARGET).size} B)`);
