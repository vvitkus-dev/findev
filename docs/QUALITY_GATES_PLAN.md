# Quality Gates Specification

> Companion to `docs/IMPLEMENTATION_PLAN.md`. This spec defines how code in this repo, whether
> written by AI or by hand, is kept high-quality. Every requirement has a measurable threshold,
> one command with a deterministic pass/fail, and a place where it runs (agent hook → pre-commit
> → pre-push → CI → deploy gate).

**Conventions.** Requirement IDs are `QG-n`. Implementation steps are `Qp.s` (phase.step) and
name the requirements they satisfy. **SHALL** marks a hard requirement; a gate either passes or
blocks. Status: ✅ done and verified · ⏳ open · ◻ optional.

---

## 1. Purpose and principle

AI produces code in high volume, so **review effort moves to machines**:

1. Everything that can be checked deterministically **SHALL** be checked automatically, as early
   as possible (agent hook → commit hook → push hook → CI).
2. Deploy **SHALL** be blocked unless every gate is green.
3. Every gate **SHALL** be proven to fire by a probe (a silently misconfigured linter is the most
   common failure).
4. Thresholds **SHALL NOT** be lowered to make code pass. Raising them is allowed; lowering one
   needs an explicit `chore(quality): lower threshold — <reason>` commit.

Human review then focuses on design and intent.

---

## 2. Requirements

### 2.1 Static

| ID    | Requirement                                                                                                                                                    | Threshold                                                                    | Verified by                      | Steps       | Status |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------- | ----------- | ------ |
| QG-1  | App, spec, worker and Node test code **SHALL** compile under maximum TS strictness, with Angular `strictTemplates` and extended diagnostics as errors.         | 0 errors                                                                     | `npm run lint:types`, `ng build` | Q0.1        | ✅     |
| QG-2  | TS, templates (incl. a11y) and tests **SHALL** lint clean with type-aware rules.                                                                               | 0 errors, 0 warnings                                                         | `npm run lint`                   | Q0.2, Q0.5  | ✅     |
| QG-3  | Functions and templates **SHALL** stay within complexity limits.                                                                                               | TS cyclomatic ≤ 10, cognitive ≤ 15; template cyclomatic ≤ 8, conditional ≤ 4 | `npm run lint`                   | Q0.3        | ✅     |
| QG-4  | Code units **SHALL** stay within size limits.                                                                                                                  | function ≤ 60 lines, file ≤ 300 lines (specs 600), params ≤ 4, depth ≤ 3     | `npm run lint`                   | Q0.3        | ✅     |
| QG-5  | Rust **SHALL** pass clippy `all` + `pedantic` with no `unwrap`/`expect`/`panic`/`todo` outside tests, and be rustfmt-clean.                                    | cognitive ≤ 7, nesting ≤ 4, ≤ 60 lines and ≤ 4 args per function             | `npm run test:rust`              | Q0.9        | ✅     |
| QG-6  | Architecture rules **SHALL** be lint errors that `eslint-disable` cannot switch off: import boundaries, framework-free `engine/`, banned APIs (see Q0.4).      | 0 violations                                                                 | `npm run lint`, lint probes      | Q0.4, Q1.5  | ✅     |
| QG-7  | Every `eslint-disable` **SHALL** carry a `-- reason`.                                                                                                          | 0 undescribed disables                                                       | `npm run lint`                   | Q1.5        | ✅     |
| QG-8  | Duplicated code **SHALL** stay under the limit across TS, HTML, SCSS and Rust.                                                                                 | ≤ 3 % (min 50 tokens)                                                        | `npm run dup`                    | Q0.7        | ✅     |
| QG-9  | The repo **SHALL** contain no unused files, exports or dependencies.                                                                                           | 0 findings                                                                   | `npm run deadcode`               | Q0.8        | ✅     |
| QG-10 | Production dependencies **SHALL** have no known high/critical vulnerabilities; every direct dependency **SHALL** be pinned exactly to a release ≥ 14 days old. | 0 high+ advisories; 0 ranges, 0 young releases, 0 lockfile drift             | `npm run audit`, `deps:age`      | Q0.10, Q2.0 | ✅     |
| QG-11 | Formatting **SHALL** be canonical.                                                                                                                             | 0 unformatted files                                                          | `npm run format:check`           | Q0.11       | ✅     |

### 2.2 Tests

| ID    | Requirement                                                                                                                                     | Threshold                                                    | Verified by                          | Steps      | Status |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------ | ---------- | ------ |
| QG-12 | Every test **SHALL** follow Arrange → Act → Assert, with exactly one `// Act` (Angular's `await fixture.whenStable()` belongs to Act).          | 0 violations                                                 | `local/aaa-sections` lint rule       | Q0.6       | ✅     |
| QG-13 | Tests **SHALL** be deterministic: no focused/skipped tests, no conditionals, no real-time sleeps in unit/integration tests; every test asserts. | 0 violations                                                 | Vitest lint rules                    | Q0.5       | ✅     |
| QG-14 | Line, branch, function and statement coverage **SHALL** meet two tiers; files no test loads **SHALL** count.                                    | global ≥ 65 %; `core/producer/**`, `shared/format/**` ≥ 85 % | `npm run test:ci`                    | Q2.1, Q2.2 | ✅     |
| QG-15 | Rust line and function coverage **SHALL** meet the critical tier.                                                                               | ≥ 85 %                                                       | `npm run cov:rust`                   | Q2.3       | ✅     |
| QG-16 | Tests **SHALL** detect injected bugs.                                                                                                           | TS mutation score ≥ 80 %; every Rust mutant killed           | `test:mutation`, `test:rust:mutants` | Q5.0, Q5.1 | ✅     |
| QG-17 | The suite **SHALL** have unit, integration and E2E layers (§4.1).                                                                               | integration ≥ 3                                              | `npm run test:pyramid`               | Q2.4, Q3.2 | ✅     |
| QG-18 | The suite **SHALL** be a pyramid, not an ice-cream cone.                                                                                        | E2E ≤ 10 % of tests, unit ≥ 60 %                             | `npm run test:pyramid`               | Q4.1       | ✅     |
| QG-19 | Both pages and the error banner **SHALL** have no serious or critical WCAG 2.0/2.1 A/AA violations.                                             | 0                                                            | axe spec in `npm run e2e`            | Q3.3       | ✅     |
| QG-20 | Visual changes to stable regions **SHALL** fail against committed baselines rendered in the pinned CI image.                                    | ≤ 100 differing pixels                                       | `@visual` specs in `npm run e2e`     | Q3.4       | ✅     |
| QG-21 | The live deploy **SHALL** be smoke-tested after every deploy.                                                                                   | new SHA served; `@smoke` specs green                         | CI `smoke`, `smoke-e2e` jobs         | Q3.5       | ✅     |

### 2.3 Process

| ID    | Requirement                                                                                                  | Threshold                                | Verified by                       | Steps      | Status |
| ----- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------- | ---------- | ------ |
| QG-22 | Every file the agent edits **SHALL** be formatted and linted immediately, with errors fed back to the agent. | blocking on ESLint errors                | `PostToolUse` hook                | Q1.4       | ✅     |
| QG-23 | Commits **SHALL** pass lint-staged and use conventional messages without AI attribution.                     | pre-commit + commit-msg exit 0           | husky, lint-staged, commitlint    | Q1.1, Q1.2 | ✅     |
| QG-24 | Pushes **SHALL** pass `verify:fast`.                                                                         | exit 0                                   | husky pre-push                    | Q1.3       | ✅     |
| QG-25 | CI **SHALL** run every gate on every push and deploy only from `main` when all gate jobs are green.          | deploy `needs` every gate job            | `.github/workflows/ci-deploy.yml` | Q4.2       | ✅     |
| QG-26 | Pull requests **SHALL** stay reviewable.                                                                     | ≤ 600 changed lines (generated excluded) | CI `pr-size` job                  | Q4.3       | ✅     |
| QG-27 | Every gate **SHALL** have a probe that proves it fires, plus negative probes against false positives.        | all probes pass                          | `npm run quality:self-test`       | all        | ✅     |
| QG-28 | The README **SHALL** document the gates: controls, thresholds, commands, how to update visual baselines.     | each `static`/`verify` script named      | grep on `README.md`               | Q4.4       | ⏳     |
| QG-29 | An external dashboard **MAY** mirror the local gates; local tools stay the source of truth.                  | Quality Gate "Passed"                    | SonarCloud                        | Q5.2       | ◻      |

---

## 3. Design decisions

| Control                 | Options considered                                                                            | Choice                                    | Rationale                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Type safety             | TS `strict` only · **strict + extra flags + strictTemplates + extendedDiagnostics as errors** | **Max strictness**                        | Cheapest bug filter for generated code; compile-time, zero runtime cost                                                                    |
| Linter                  | **ESLint + angular-eslint** · Biome · oxlint                                                  | **ESLint + angular-eslint 22**            | Only option that lints Angular **templates** (control flow, a11y, complexity) with type-aware rules; Biome/oxlint have no template support |
| Complexity              | ESLint `complexity` · **+ `sonarjs/cognitive-complexity`** · SonarCloud                       | **ESLint core + SonarJS + template rule** | Cyclomatic (paths) and cognitive (readability) measure different things; both local, deterministic, editor-visible                         |
| Duplication             | **jscpd** · SonarCloud CPD · PMD-CPD                                                          | **jscpd**                                 | npm-native, multi-language (TS, HTML, SCSS, Rust), threshold → exit code, HTML report                                                      |
| Dead code               | **knip** · ts-prune (archived)                                                                | **knip**                                  | Finds unused files/exports/deps, the typical leftover of AI iterations                                                                     |
| Formatting              | **Prettier**                                                                                  | Prettier                                  | Removes style noise from AI diffs                                                                                                          |
| Unit/integration runner | **Vitest via `@angular/build:unit-test`**                                                     | (scaffold)                                | Native coverage thresholds                                                                                                                 |
| Coverage                | **`@vitest/coverage-v8`** · istanbul                                                          | **v8**                                    | Fast, no instrumentation build step; per-glob thresholds via `runnerConfig`                                                                |
| Rust coverage           | **cargo-llvm-cov** · tarpaulin                                                                | **cargo-llvm-cov**                        | Precise LLVM source-based coverage on macOS and Linux                                                                                      |
| E2E                     | **Playwright** · Cypress                                                                      | **Playwright**                            | Web Worker support, auto-wait, `toHaveScreenshot`, trace viewer, request interception for error-path tests                                 |
| Accessibility           | **@axe-core/playwright**                                                                      | axe                                       | Cheap add-on to E2E                                                                                                                        |
| Visual regression       | **Playwright snapshots** · Chromatic/Percy                                                    | **Playwright snapshots**                  | No external SaaS; baselines rendered in the same Linux image CI uses                                                                       |
| Local hooks             | **husky + lint-staged + commitlint** · lefthook                                               | **husky + lint-staged + commitlint**      | Ubiquitous, npm-only; commitlint also enforces the "no AI attribution" rule                                                                |
| Agent-loop hook         | **Claude Code `PostToolUse` hook**                                                            | yes                                       | Errors surface _during_ generation, not at PR time                                                                                         |
| Mutation testing        | **StrykerJS (Vitest runner)** · custom Rust mutants                                           | both                                      | Coverage can be gamed by assertion-free tests; mutants prove tests assert                                                                  |

---

## 4. Gate matrix (where each control runs)

| Control                                          | Req.             | Agent hook | pre-commit          | pre-push | CI job               | Blocks deploy |
| ------------------------------------------------ | ---------------- | ---------- | ------------------- | -------- | -------------------- | ------------- |
| Prettier                                         | QG-11            | ✅ file    | ✅ staged           | ✅       | `static`             | ✅            |
| ESLint (TS, templates, complexity, architecture) | QG-2…4, 6, 7, 12 | ✅ file    | ✅ staged           | ✅       | `static`             | ✅            |
| Type-check (app/spec/worker/Node)                | QG-1             |            |                     | ✅       | `static`             | ✅            |
| jscpd, knip, audit, deps:age                     | QG-8…10          |            |                     | ✅       | `static`             | ✅            |
| clippy + rustfmt + cargo test                    | QG-5             |            | ✅ if `*.rs` staged | ✅       | `test`               | ✅            |
| commitlint                                       | QG-23            |            | commit-msg          |          | —                    | —             |
| Unit + integration + coverage 65/85              | QG-14, 17        |            |                     | ✅       | `test`               | ✅            |
| Wasm ABI check + Node suite on real `.wasm`      | QG-17            |            |                     | ✅       | `test`               | ✅            |
| Rust coverage ≥ 85 %                             | QG-15            |            |                     |          | `test`               | ✅            |
| Mutation (Stryker + Rust mutants)                | QG-16            |            |                     |          | `test`               | ✅            |
| Test pyramid ratio                               | QG-18            |            |                     |          | `test`               | ✅            |
| Gate probes                                      | QG-27            |            |                     |          | `self-test`          | ✅            |
| E2E + axe + visual                               | QG-17, 19, 20    |            |                     |          | `e2e`                | ✅            |
| PR size                                          | QG-26            |            |                     |          | `pr-size` (PRs)      | —             |
| Post-deploy smoke                                | QG-21            |            |                     |          | `smoke`, `smoke-e2e` | (alerts)      |

`npm run verify` runs every row above locally except the PR-size and post-deploy jobs.

---

## 5. Test specification

### 5.1 Layers

| Layer           | Definition                                                                                       | Location / naming                               | Runtime budget |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | -------------- |
| **Unit**        | One module, collaborators faked; pure functions, Rust modules, single components with stub store | `*.spec.ts`, Rust `#[cfg(test)]`                | < 20 s total   |
| **Integration** | ≥ 2 real units wired together, only process boundaries faked                                     | `*.integration.spec.ts`, `wasm-tests/*.test.ts` | < 15 s         |
| **E2E**         | Real browser, real Pages-shaped build, real worker + Wasm                                        | `e2e/*.e2e.ts`                                  | < 90 s         |

Integration tests:

- **I1** Node: `ProducerEngine` + **real compiled Wasm** + `ManualScheduler`. Totals equal an independent sum over the generated words; pause/apply semantics with the real generator.
- **I2** `producer-store.integration.spec`: `ProducerStore` + `FakeWorker` + real `Dashboard`/`Settings` components + `RouterTestingHarness`. Apply resets, stale snapshots are rejected, navigation keeps the single worker and the paused state.
- **I3** Every `FromWorker`/`ToWorker` message survives `structuredClone` deep-equal.
- **I4** `wasm-tests/`: TS adapter + real `.wasm`.

E2E scenarios (Playwright, Chromium):

| ID  | Scenario                                                                                                                         | Tag       |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------- |
| E1  | Dashboard boots with 5 rows; within 3 s every row has a price, volume > 0, spread > $0.00, imbalance ∈ [−1, +1].                 | `@smoke`  |
| E2  | Pause → status "Paused" → volumes unchanged over the observation window → Resume → volumes increase.                             |           |
| E3  | Settings validation: `0` and `1.5` show errors and disable Apply; valid `10/50/100` → Apply → 10 rows, run #2, totals restarted. |           |
| E4  | Navigation keeps state: pause → Settings → Dashboard → still paused, same totals.                                                |           |
| E5  | Init error: `producer.wasm` answers 404 → error banner with message → unroute → Retry → running.                                 | `@smoke`  |
| E6  | Accessibility: axe on `/dashboard`, `/settings` with a field error, and the error banner → 0 serious/critical.                   |           |
| E7  | Visual: `/settings` full page and the paused dashboard, live numeric cells masked.                                               | `@visual` |

**Determinism rules:** assert invariants, never exact random values; wait with `expect.poll` and
web-first assertions; the only fixed waits are a 200 ms settle after Pause (an in-flight batch is
accepted by design) and a 1 s observation window; retries 0 locally, 1 in CI with a trace on the
first retry (a retry that passes is reported as flaky).

### 5.2 AAA convention

```ts
it('drops snapshots from a previous run', async () => {
  // Arrange
  const { store, worker } = setup();
  worker.emit(snapshot({ runId: 1, volume: 40 }));
  store.apply(SETTINGS_B);

  // Act
  worker.emit(snapshot({ runId: 1, volume: 99 }));
  await fixture.whenStable(); // Angular "Wait" step belongs to Act

  // Assert
  expect(store.rows()[0].volume).toBe(0);
});
```

Rules: exactly one `// Act` per test (one behaviour per test); `// Arrange` may be omitted when
empty; no `if`/loops in tests; every test asserts; Rust tests use the same comments.

### 5.3 Coverage scopes

| Scope                                                                                                            | statements | branches | functions | lines |
| ---------------------------------------------------------------------------------------------------------------- | ---------- | -------- | --------- | ----- |
| Global (`src/app/**`, excl. `*.spec.ts`, `main.ts`, `app.config.ts`, `*.model.ts`, `producer.worker.ts` adapter) | 65         | 65       | 65        | 65    |
| Critical: `src/app/core/producer/**`, `src/app/shared/format/**`                                                 | 85         | 85       | 85        | 85    |
| Rust `wasm/producer/src/**` (cargo-llvm-cov)                                                                     | —          | —        | 85        | 85    |

---

## 6. Implementation steps

Each step lists the **work** and a **control check**: a command with an exact expected result.
Phase Q0 runs before Implementation Phase 1, so all generated code is gated from its first line.

### Phase Q0 — Static baseline (after Implementation Phase 0)

| Step  | Req.       | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Control check                                                                                                                                                          |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q0.1  | QG-1       | `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `forceConsistentCasingInFileNames`. `angularCompilerOptions`: `strictTemplates`, `strictInjectionParameters`, `extendedDiagnostics: { defaultCategory: "error" }`. `lint:types` = `tsc --noEmit -p` for the app, spec, worker and `wasm-tests` configs.                                                                                            | `npm run lint:types` exit 0; probe `const a: string[] = []; a[0].length` fails with `TS2532`                                                                           |
| Q0.2  | QG-2       | `angular-eslint@22` flat config; `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`; Angular TS, template and accessibility presets. Key rules: `no-explicit-any`, `no-non-null-assertion`, `no-floating-promises`, `template/prefer-control-flow`, `template/prefer-self-closing-tags`, `prefer-signals`, `no-console` (allow `warn`/`error`). `lint` = `ng lint --max-warnings 0`.                                                                                                                                          | `npm run lint` exit 0; probe `let x: any` → `no-explicit-any`                                                                                                          |
| Q0.3  | QG-3, QG-4 | `complexity` 10, `max-depth` 3, `max-params` 4, `max-lines-per-function` 60, `max-lines` 300 (specs: function length off, 600 lines); `sonarjs/cognitive-complexity` 15; template `cyclomatic-complexity` 8, `conditional-complexity` 4.                                                                                                                                                                                                                                                                                                    | 12-branch function → `complexity`; 9 nested `@if` → template rule                                                                                                      |
| Q0.4  | QG-6       | `no-restricted-imports`: (a) `core/producer/engine/**` must not import `@angular/*` or `rxjs` (folder rule, so new files are covered); (b) `core/**` must not import `features/**`; (c) `shared/**` must not import `core/**` or `features/**`; (d) no feature imports another feature. `no-restricted-syntax`: `Math.random` in `core/producer/**`; `@Injectable`; `fixture.detectChanges`/`markForCheck` in specs; `FormGroup`/`FormControl`/`FormBuilder`/`ReactiveFormsModule`. These replace the IMPLEMENTATION_PLAN §4.0 grep guards. | `scripts/lint-probes.mjs` writes one probe per rule into the real folders, plus negative probes that must not fire, lints them, checks rule ids, deletes them → exit 0 |
| Q0.5  | QG-13      | `@vitest/eslint-plugin` on specs and `wasm-tests/**`: `no-focused-tests`, `no-disabled-tests`, `expect-expect`, `no-identical-title`, `no-conditional-in-test`, `no-standalone-expect`, `max-nested-describe` 2, `consistent-test-it: it`.                                                                                                                                                                                                                                                                                                  | probes `it.only` and an assertion-free test → expected rule ids                                                                                                        |
| Q0.6  | QG-12      | Local rule `local/aaa-sections`: every `it`/`test` body has `// Act` exactly once and `// Assert` at least once, in order, with `// Arrange` (if present) first. Own `RuleTester` spec.                                                                                                                                                                                                                                                                                                                                                     | RuleTester spec green; probe without `// Act` → `local/aaa-sections`                                                                                                   |
| Q0.7  | QG-8       | `jscpd` 5 with `.jscpd.json`: threshold 3 %, `minTokens` 50, `minLines` 6, formats TS/markup/SCSS/Rust over `src`, `wasm/producer/src`, `wasm-tests`; specs ignored; reports in `reports/jscpd`. The gate is the % threshold, not single clones. Script `dup`.                                                                                                                                                                                                                                                                              | `npm run dup` exit 0; duplicated 30-line function → exit 1                                                                                                             |
| Q0.8  | QG-9       | `knip` (entries: `src/main.ts`, the worker, `scripts/*.mjs`, `wasm-tests/**`). Script `deadcode`.                                                                                                                                                                                                                                                                                                                                                                                                                                           | `npm run deadcode` exit 0; unused exported function → non-zero                                                                                                         |
| Q0.9  | QG-5       | Cargo `[lints]` denies `clippy::all`, `clippy::pedantic`, `unwrap_used`/`expect_used`/`panic`/`todo` outside tests; `clippy.toml` thresholds per QG-5; rustfmt defaults. Delivered with Implementation step 1.1 (needs the crate).                                                                                                                                                                                                                                                                                                          | `npm run test:rust` exit 0; 7 Rust probes in `quality-probes.mjs` read exact lint codes from cargo JSON                                                                |
| Q0.10 | QG-10      | `audit` = `npm audit --omit=dev --audit-level=high`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | exit 0                                                                                                                                                                 |
| Q0.11 | QG-11      | Aggregates: `static` = format:check, lint, lint:types, dup, deadcode, audit, deps:age; `verify:fast` = static, test:rust, wasm:build, test:wasm, test:ci; `verify` = everything in §4 that runs locally.                                                                                                                                                                                                                                                                                                                                    | `npm run static` exit 0                                                                                                                                                |

**Q0 exit criteria:** `npm run static` exit 0 **and** `npm run quality:self-test` exit 0.

**Notes.**

- Rust cognitive complexity was lowered from the planned 10 to **7**: clippy's score has no nesting weight (a function 3 loops deep with compound conditions scored 9), so `excessive_nesting` (≤ 4) was added too. Wasm uses `panic = "abort"`, so a panic would trap the worker.
- `quality:self-test` = `lint:probes` (ESLint probes, incl. false-positive guards) + `test:lint-rules` (AAA RuleTester) + `quality:probes` (jscpd, knip, Rust, coverage, deps:age, mutation).

### Phase Q1 — Local and agent-loop enforcement (right after Q0)

| Step | Req.       | Work                                                                                                                                                                                  | Control check                                                                               |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Q1.1 | QG-23      | `husky` + `lint-staged`: pre-commit runs Prettier + `eslint --fix --max-warnings 0` on staged files; `cargo fmt` + clippy when `*.rs` is staged.                                      | staged lint error → `git commit` exits non-zero                                             |
| Q1.2 | QG-23      | `commitlint` (`config-conventional`) on commit-msg, plus a rule rejecting Claude/Anthropic mentions and "Generated with …" lines; human `Co-authored-by` stays allowed.               | AI-attributed message → exit 1; `feat(core): add metrics` → exit 0                          |
| Q1.3 | QG-24      | pre-push runs `npm run verify:fast`.                                                                                                                                                  | push with a failing unit test is rejected locally                                           |
| Q1.4 | QG-22      | `.claude/settings.json` `PostToolUse` on `Edit\|Write` → `scripts/agent-lint-file.mjs` runs Prettier + ESLint on the edited file; exit 2 on lint errors feeds them back to the agent. | an `any` added through the agent → hook shows `no-explicit-any`                             |
| Q1.5 | QG-6, QG-7 | `eslint-comments/require-description` + `no-unlimited-disable`; `no-restricted-disable` on architecture rules. `CLAUDE.md` documents commands and thresholds.                         | undescribed `eslint-disable-next-line` → lint error; disabling an architecture rule → error |

**Q1 exit criteria:** `npm run hook:probes` exit 0. It makes real commits and pushes in a throwaway worktree against a temporary bare remote and checks 5 cases: pre-commit blocks a lint error, pre-commit passes a clean file, commit-msg blocks a non-conventional message, commit-msg blocks AI attribution, pre-push blocks a failing test.

### Phase Q2 — Coverage and supply chain (with Implementation Phase 2; tighten through Phase 7)

| Step | Req.  | Work                                                                                                                                                                                                                                                                                     | Control check                                                                            |
| ---- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Q2.0 | QG-10 | Pin every direct dependency exactly to a release ≥ 14 days old; re-resolve the lockfile with `npm install --before=<date>` so transitive dependencies are old enough too; `.npmrc` `save-exact=true`. `deps:age` fails on ranges, young releases or drift, and names the version to use. | `npm run deps:age` exit 0; 4 probes with a pinned `DEPS_AGE_NOW`                         |
| Q2.1 | QG-14 | `@vitest/coverage-v8`; `angular.json` test configuration `ci`: `coverage: true`, reporters `text-summary`/`lcov`/`json-summary`/`html` → `coverage/findev`, **`coverageInclude: ["src/app/**/*.ts"]`**, `coverageExclude` per §5.3, global floor 65 %. `test:ci` runs it.                | `npm run test:ci` prints the summary, exit 0                                             |
| Q2.2 | QG-14 | `runnerConfig: vitest-base.config.mts` adds the 85 % per-glob floors (the builder's own thresholds can't express globs).                                                                                                                                                                 | a probe file breaks **exactly one** floor (glob or global) and forbids the other message |
| Q2.3 | QG-15 | `cargo-llvm-cov` 0.9.1 (`cargo +1.99.0 install … --locked`); `cov:rust` gates `--fail-under-lines 85 --fail-under-functions 85`, then writes `reports/rust.lcov`. Runs in `verify`, not `verify:fast` (instrumented rebuild is slower).                                                  | `npm run cov:rust` exit 0; probe with 20 untested functions → exit 1 with a `TOTAL` row  |
| Q2.4 | QG-17 | Integration tests I1–I4 (§5.1) written with Implementation Phases 3–6.                                                                                                                                                                                                                   | `npm run test:pyramid` reports integration ≥ 3                                           |

**Q2 exit criteria:** `npm run test:ci && npm run cov:rust && npm run test:wasm` exit 0.

**Notes.**

- `coverageInclude` made `app.routes.ts` show up at 0 % immediately; untested files count.
- Coverage probes read thresholds from the scripts and configs themselves, so lowering a threshold also changes what is probed.
- Rust tests are inline `#[cfg(test)]` modules, which llvm-cov counts, so its numbers run slightly high; the Rust mutation check (Q5.0) is the stronger signal.

### Phase Q3 — E2E, accessibility, visual (after Implementation Phase 7)

| Step | Req.  | Work                                                                                                                                                                                                                                                                                                                          | Control check                                                                 |
| ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Q3.1 | QG-17 | Playwright 1.64.1 (pinned), Chromium only, `e2e/`. The suite runs on the Pages-shaped bundle (`build-pages.mjs`, base `/findev/` + `404.html`) served by `serve-dist.mjs`, which tests the sub-path worker and Wasm URLs. `retries: CI ? 1 : 0`, `trace: "on-first-retry"`, `forbidOnly` in CI.                               | `npx playwright test --list` shows the specs                                  |
| Q3.2 | QG-17 | Scenarios E1–E5 (§5.1) with role/label locators only; AAA applies (the rule covers `e2e/**/*.e2e.ts` and skips suites and hooks).                                                                                                                                                                                             | `npm run e2e` exit 0, < 90 s                                                  |
| Q3.3 | QG-19 | Scenario E6 with `@axe-core/playwright`, tags `wcag2a`/`wcag2aa`, serious/critical filtered.                                                                                                                                                                                                                                  | exit 0; a probe page (unnamed button, image without alt) fails                |
| Q3.4 | QG-20 | Scenario E7: `toHaveScreenshot` with `maxDiffPixels: 100`; masked cells via role/text locators; `e2e/support/screenshot.css` keeps masked values from shifting layout. Baselines rendered by `scripts/e2e-docker.mjs` in the CI image (tag and digest read from the workflow, `linux/amd64`); visual specs run on Linux only. | red `h1` → both specs fail and the diff marks only the heading; revert → pass |
| Q3.5 | QG-21 | After deploy, `smoke` waits for the new SHA on the live URL, then `smoke-e2e` runs the `@smoke` specs against it.                                                                                                                                                                                                             | CI `smoke` + `smoke-e2e` green                                                |

**Q3 exit criteria:** `npm run e2e` exit 0 locally and in CI; 0 flaky tests over 3 consecutive CI runs.

**Notes.**

- E2E has more tests than scenarios, because the AAA rule allows one Act per test.
- The planned `maxDiffPixelRatio: 0.01` let a red heading pass (483 px, 0.05 %), so the gate is `maxDiffPixels: 100`; 36 clean runs in the image showed 0 differing pixels.
- Evidence: locally `--repeat-each 10` and `--repeat-each 5 --workers 12` passed 165/165; CI run 44358492840 was green with 0 retries.

### Phase Q4 — CI integration, pyramid, PR hygiene (with Implementation Phase 8)

| Step | Req.  | Work                                                                                                                                                                                                                                                                                                                                              | Control check                                                   |
| ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Q4.1 | QG-18 | `scripts/test-pyramid.mjs` counts unit (Angular specs + Rust `#[test]`s), integration (`*.integration.spec.ts` + `wasm-tests/`) and E2E tests; asserts the QG-17/QG-18 limits; prints the pyramid to `$GITHUB_STEP_SUMMARY`.                                                                                                                      | exit 0; `--counts` with 50 % E2E → exit 1 ("ice-cream cone")    |
| Q4.2 | QG-25 | `.github/workflows/ci-deploy.yml` jobs: `static` ∥ `self-test` ∥ `test` (Rust, mutants, coverage, Wasm build/verify/suite, `test:ci`, pyramid, Stryker, Pages build) → `e2e` (pinned Playwright image, on the `test` bundle) → `deploy` (`main` only; needs static, self-test, test, e2e) → `smoke` → `smoke-e2e`. Reports uploaded as artifacts. | broken branch → the matching job is red and `deploy` is skipped |
| Q4.3 | QG-26 | `.github/pull_request_template.md`; `pr-size` job (pull requests only) runs `scripts/pr-size.mjs`, failing above 600 changed lines excluding generated files ("split the PR").                                                                                                                                                                    | synthetic PR > 600 lines → `pr-size` red                        |
| Q4.4 | QG-28 | README "Quality gates" section: controls, thresholds, commands, how to update visual baselines.                                                                                                                                                                                                                                                   | README names every script in `static` and `verify`              |

**Q4 exit criteria:** three consecutive green CI runs on `main` with deploy; a deliberately broken branch shows the expected red job for each gate type (static, test, e2e).

### Phase Q5 — Test effectiveness and extras

| Step | Req.  | Work                                                                                                                                                                                                           | Control check                                            |
| ---- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Q5.0 | QG-16 | `scripts/rust-mutants.mjs`: dependency-free string mutants applied to a temporary copy of the crate; each must make `cargo test` fail. Every new Rust module adds its mutants.                                 | `npm run test:rust:mutants` → "All N mutants killed"     |
| Q5.1 | QG-16 | StrykerJS 10.1.1 + Vitest runner on a Node-env project (`stryker/vitest.config.mts`) over `metrics`, `producer-settings`, `market-format`; thresholds high 90 / low 80 / break 80. Runs on every push (≈ 5 s). | `npm run test:mutation` score ≥ 80 %; probe < 80 % fails |
| Q5.2 | QG-29 | SonarCloud fed with lcov + ESLint JSON, as a dashboard only.                                                                                                                                                   | Quality Gate "Passed" badge in README                    |

**Notes.** The first Stryker run scored 89.94 % with 17 survivors. Real gaps were tested (the
50-instrument bound, error messages, half-filled quotes and books in `deriveMetrics`,
`formatVolume` rounding); equivalent mutants are marked `// Stryker disable next-line <mutator>: <reason>`.
Score is now 100 %.

---

## 7. Risks and mitigations

| Risk                                           | Mitigation                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Strict lint/complexity slows early development | Rules are on from day 0 (cheap for fresh code, expensive to retrofit); `--fix` in hooks          |
| Coverage gamed by assertion-free AI tests      | `expect-expect`, AAA rule, mutation testing (QG-16)                                              |
| Visual tests flaky across OS/fonts             | Baselines only from the pinned Playwright Linux image; stable regions only; live numbers masked  |
| E2E timing flakiness with a live worker        | Assertions on invariants + `expect.poll`; bounded fixed waits; CI retry = 1 with flaky reporting |
| CI duration growth                             | Parallel `static` ∥ `self-test` ∥ `test`; npm/cargo/Playwright caches; Chromium only             |
| Tool or dependency drift                       | Exact pins ≥ 14 days old (QG-10); every step verified by its probe right after install           |
