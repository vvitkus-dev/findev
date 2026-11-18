#!/usr/bin/env node
// Runs cargo for the Wasm producer crate: `node scripts/cargo.mjs <subcommand> [args...]`.
// - Works from git hooks / non-login shells by adding ~/.cargo/bin to PATH when cargo isn't on it.
// - Injects `--manifest-path wasm/producer/Cargo.toml` so npm scripts stay short.
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const MANIFEST = 'wasm/producer/Cargo.toml';
const [subcommand, ...rest] = process.argv.slice(2);
if (!subcommand) {
  console.error('usage: node scripts/cargo.mjs <subcommand> [args...]');
  process.exit(2);
}

const env = {
  ...process.env,
  PATH: [process.env.PATH, join(homedir(), '.cargo', 'bin')].join(delimiter),
};
// Args after `--` belong to the tool (clippy/test), so the manifest goes before them.
const sep = rest.indexOf('--');
const head = sep === -1 ? rest : rest.slice(0, sep);
const tail = sep === -1 ? [] : rest.slice(sep);
const r = spawnSync('cargo', [subcommand, '--manifest-path', MANIFEST, ...head, ...tail], {
  stdio: 'inherit',
  env,
});
if (r.error) {
  console.error(`cargo not found — install Rust via rustup (see README). ${r.error.message}`);
  process.exit(127);
}
process.exit(r.status ?? 1);
