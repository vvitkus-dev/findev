# Bugfix — Rust coverage fails on a fresh checkout

> Found by the first CI run · Fixed in `f69c687` · Requirements: QG-15

## Current behaviour

WHEN `npm run cov:rust` runs on a fresh checkout THEN the threshold check passes but writing `reports/rust.lcov` fails, because `reports/` doesn't exist.

## Expected behaviour

THE SYSTEM SHALL create `reports/` before writing the lcov file, so `cov:rust` passes on a fresh checkout.

## Unchanged behaviour

- Thresholds (≥ 85 % lines and functions) and the lcov path are unchanged.

## Root cause

The script wrote into `reports/` without creating it. Locally the folder already existed, so the gap never showed.

## Tasks

- [x] Reproduce: delete `reports/`, run `npm run cov:rust` → fails.
- [x] Create the folder in the script; the same command passes, and the CI `test` job is green.
