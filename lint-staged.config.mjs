// Pre-commit gate (docs/QUALITY_GATES_PLAN.md Q1.1): format + lint only the staged files.
// Rust (`*.rs` → cargo fmt / clippy) is added with the crate in Implementation step 1.1.
export default {
  '*.{ts,html}': ['prettier --write', 'eslint --fix --max-warnings 0'],
  '*.{scss,css,json,jsonc,md,mjs,js,yml,yaml}': ['prettier --write'],
};
