## What and why

<!-- One behaviour per PR. What changes, and why it is needed. Link the plan step (e.g. Q4.3, 9.1). -->

## Test evidence

<!-- New or changed tests, and how you checked the change (commands, CI run, screenshots). -->

## Checklist

- [ ] `npm run verify` passes locally (static, self-test, Rust, Wasm, unit + coverage, pyramid, build, E2E)
- [ ] New code has tests; each test uses `// Arrange` / `// Act` / `// Assert`
- [ ] No gate was weakened: no lowered thresholds, and every `eslint-disable` has a `-- reason`
- [ ] Visual baselines regenerated with `npm run e2e:update-snapshots` only for intended UI changes
- [ ] Changed lines ≤ 600 (excluding `package-lock.json`, `e2e/__screenshots__/`, `.claude/skills/`)
- [ ] New dependencies are pinned to releases at least 14 days old
