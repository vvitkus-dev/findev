// Pre-commit gate (specs/quality-gates/tasks.md Q1.1): format + lint only the staged files.
export default {
  '*.{ts,html}': ['prettier --write', 'eslint --fix --max-warnings 0'],
  '*.{scss,css,json,jsonc,md,mjs,js,yml,yaml}': ['prettier --write'],
  // Rust: format, then fmt-check + clippy (native and wasm32) on the whole crate — clippy needs it.
  'wasm/producer/**/*.{rs,toml}': () => ['node scripts/cargo.mjs fmt', 'npm run -s rust:lint'],
};
