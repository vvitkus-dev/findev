# Quality Gates Plan — static & dynamic controls

> Companion to `docs/IMPLEMENTATION_PLAN.md`. Defines **how AI-generated (and human) code is kept high-quality**: every control is a tool with a configured threshold, a command with a deterministic pass/fail, and a place where it runs (editor/agent hook → pre-commit → CI → deploy gate).

---

## 0. Source analysis (the two reference slides)

### Slide 1 — "How do you keep FE code quality high when working with AI?"

| Category    | Item on slide                                | Interpretation for this repo                                                                                                                        |
| ----------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Static**  | TypeScript                                   | Maximum compiler strictness for app, specs, worker and Node test code; Angular `strictTemplates` + extended diagnostics as errors                   |
|             | Linter                                       | ESLint (flat config) with `angular-eslint` (TS + templates + a11y), `typescript-eslint` strict type-checked rules, Vitest rules; Rust `clippy`      |
|             | Static code analysis → cyclomatic complexity | Hard thresholds: ESLint `complexity`, SonarJS `cognitive-complexity`, Angular template `cyclomatic-complexity`; Rust `clippy::cognitive_complexity` |
|             | Static code analysis → code duplication      | `jscpd` over TS/HTML/SCSS/Rust with a % threshold                                                                                                   |
| **Dynamic** | Unit tests                                   | Vitest (`ng test`) + `cargo test`                                                                                                                   |
|             | Integration tests                            | Real collaborators wired together (engine + real Wasm; store + real components + real router)                                                       |
|             | End-to-end tests                             | Playwright against the production build (and against the live deploy as a smoke)                                                                    |

### Slide 2 — "AI generates hundreds of lines & massive PRs — what's your approach to FE testing?"

| Item on slide                         | Interpretation                                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AAA pattern**                       | Every test is Arrange → Act → Assert (Angular zoneless variant: Arrange → Act → `await whenStable()` → Assert). Enforced by lint rules + a local ESLint rule (see Q1.6).                          |
| **Test coverage ⇒ 65 % / 85 %**       | Two-tier thresholds: **≥ 65 % global floor** for the whole app, **≥ 85 % for critical logic** (`core/producer/**`, `shared/format/**`, Rust generator). Build fails below either.                 |
| **Testing pyramid vs ice-cream cone** | Target a pyramid (many fast unit tests, fewer integration, very few E2E). The **ice-cream cone (E2E-heavy) is the anti-pattern** to avoid. Enforced by a test-count ratio check (Q4.1).           |
| **Unit / Integration / E2E**          | Same three layers as slide 1, with explicit counts and locations (§3).                                                                                                                            |
| **Boxed layout with one red panel**   | Read as **visual regression testing**: page screenshots compared to baselines, with the changed region highlighted. Implemented with Playwright `toHaveScreenshot` on stable regions only (Q3.4). |

### Derived principle for AI-generated code

AI output volume is high, so **review effort must be shifted to machines**: anything that can be checked deterministically is checked automatically, as early as possible (agent hook → commit hook → CI), and **deploy is blocked unless every gate is green**. Human review then focuses on design and intent.

---

## 1. Tool selection & trade-offs

| Control                    | Options considered                                                                            | Choice                                    | Why                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type safety                | TS `strict` only · **strict + extra flags + strictTemplates + extendedDiagnostics as errors** | **Max strictness**                        | Cheapest bug filter for generated code; compile-time, zero runtime cost                                                                                                            |
| Linter                     | **ESLint + angular-eslint** · Biome · oxlint                                                  | **ESLint + angular-eslint 22**            | Only option that lints Angular **templates** (control flow, a11y, template complexity) and supports type-aware rules. Biome/oxlint are faster but have no Angular template support |
| Complexity                 | ESLint core `complexity` · **+ `sonarjs/cognitive-complexity`** · SonarCloud                  | **ESLint core + SonarJS + template rule** | Cyclomatic (paths) and cognitive (readability) measure different things; both local, deterministic, editor-visible. SonarCloud = optional dashboard (Q5)                           |
| Duplication                | **jscpd** · SonarCloud CPD · PMD-CPD                                                          | **jscpd**                                 | npm-native, multi-language (TS, HTML, SCSS, Rust), threshold → exit code, HTML report                                                                                              |
| Dead code                  | **knip** · ts-prune (archived)                                                                | **knip**                                  | Finds unused files/exports/deps — typical leftover of AI iterations                                                                                                                |
| Formatting                 | **Prettier** (already present)                                                                | Prettier                                  | Removes style noise from AI diffs                                                                                                                                                  |
| Unit/integration runner    | **Vitest via `@angular/build:unit-test`**                                                     | (existing)                                | Already scaffolded; native coverage thresholds                                                                                                                                     |
| Coverage                   | **`@vitest/coverage-v8`** · istanbul                                                          | **v8**                                    | Fast, no instrumentation build step; per-glob thresholds via `runnerConfig`                                                                                                        |
| Rust coverage              | **cargo-llvm-cov** · tarpaulin                                                                | **cargo-llvm-cov**                        | Precise LLVM source-based coverage, works on macOS + Linux                                                                                                                         |
| E2E                        | **Playwright** · Cypress                                                                      | **Playwright**                            | Native Web Worker support, auto-wait, `toHaveScreenshot`, trace viewer, request interception for error-path tests, single dependency                                               |
| Accessibility (dynamic)    | **@axe-core/playwright**                                                                      | axe                                       | Cheap add-on to E2E; zero serious/critical violations                                                                                                                              |
| Visual regression          | **Playwright snapshots** · Chromatic/Percy                                                    | **Playwright snapshots**                  | No external SaaS/account; baselines generated in the same Linux image CI uses                                                                                                      |
| Local hooks                | **husky + lint-staged + commitlint** · lefthook                                               | **husky + lint-staged + commitlint**      | Ubiquitous, npm-only; commitlint also enforces the "no AI attribution in commits" rule                                                                                             |
| Agent-loop hooks           | **Claude Code `PostToolUse` hook**                                                            | yes                                       | Lint/format feedback on every file the agent edits — errors surface _during_ generation, not at PR time                                                                            |
| Mutation testing (stretch) | **StrykerJS (vitest runner)**                                                                 | stretch                                   | Proves tests actually assert (coverage alone can be gamed by AI-written assertion-free tests)                                                                                      |

---

## 2. Gate matrix (where each control runs)

| Control                                           | Agent hook (per edit) | pre-commit            | pre-push           | CI `static`   | CI `test` | CI `e2e`     | Blocks deploy |
| ------------------------------------------------- | --------------------- | --------------------- | ------------------ | ------------- | --------- | ------------ | ------------- |
| Prettier                                          | ✅ (file)             | ✅ (staged)           |                    | ✅            |           |              | ✅            |
| ESLint (TS + templates + complexity + boundaries) | ✅ (file)             | ✅ (staged)           |                    | ✅            |           |              | ✅            |
| Type-check (app/spec/worker/node)                 |                       |                       | ✅                 | ✅            |           |              | ✅            |
| jscpd duplication                                 |                       |                       |                    | ✅            |           |              | ✅            |
| knip dead code                                    |                       |                       |                    | ✅            |           |              | ✅            |
| clippy + rustfmt                                  |                       | ✅ (if `*.rs` staged) |                    | ✅            |           |              | ✅            |
| npm audit (prod deps, high+)                      |                       |                       |                    | ✅            |           |              | ✅            |
| commitlint (conventional, no AI attribution)      |                       | commit-msg            |                    | ✅ (PR range) |           |              | —             |
| Unit + integration + coverage 65/85               |                       |                       | ✅ (`verify:fast`) |               | ✅        |              | ✅            |
| Rust tests + llvm-cov ≥ 85 %                      |                       |                       |                    |               | ✅        |              | ✅            |
| Wasm ABI tests (Node)                             |                       |                       |                    |               | ✅        |              | ✅            |
| Test pyramid ratio                                |                       |                       |                    |               | ✅        |              | ✅            |
| E2E + axe + visual                                |                       |                       |                    |               |           | ✅           | ✅            |
| Post-deploy smoke E2E on live URL                 |                       |                       |                    |               |           | after deploy | (alerts)      |

---

## 3. Test strategy (pyramid, AAA, coverage)

### 3.1 Pyramid targets for this project

| Layer           | Definition here                                                                                  | Location / naming                               | Target count | Runtime budget |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------ | -------------- |
| **Unit**        | One module, collaborators faked; pure functions, Rust modules, single components with stub store | `*.spec.ts`, Rust `#[cfg(test)]`                | ~120–180     | < 20 s total   |
| **Integration** | ≥ 2 real units wired together, only process boundaries faked                                     | `*.integration.spec.ts`, `wasm-tests/*.test.ts` | ~15–25       | < 15 s         |
| **E2E**         | Real browser, real build, real worker + Wasm                                                     | `e2e/*.e2e.ts`                                  | **5–7**      | < 90 s         |

Planned integration tests:

- **I1** `producer-engine.integration.spec` (Node): `ProducerEngine` + **real compiled Wasm** + `ManualScheduler` — totals equal an independent sum over the generated words; pause/apply semantics with real generator.
- **I2** `producer-store.integration.spec`: `ProducerStore` + `FakeWorker` + real `Dashboard`/`Settings` components + `RouterTestingHarness` — apply resets, stale snapshot rejection, navigation keeps the single worker & paused state.
- **I3** `protocol.integration.spec`: every `FromWorker`/`ToWorker` message survives `structuredClone` deep-equal (catches non-cloneable payloads).
- **I4** `wasm-tests/producer.wasm.test.ts`: TS adapter + real `.wasm` (already in main plan 2.5).

Planned E2E (Playwright, Chromium):

1. Dashboard boots with 5 rows; within 3 s every row has a price, volume > 0, spread > $0.00, imbalance ∈ [−1, +1].
2. Pause → status "Paused" → volumes unchanged after 1.2 s (> 2 intervals) → Resume → volumes increase.
3. Settings validation: `0` and `1.5` show errors and disable Apply; valid `10/50/100` → Apply → dashboard shows 10 rows, run #2, totals restarted.
4. Navigation keeps state: pause → Settings → Dashboard → still paused, same totals.
5. Init error path: `page.route('**/producer.wasm', 404)` → error banner with message → unroute → Retry → running.
6. Accessibility: axe on `/dashboard` and `/settings` → 0 serious/critical violations.
7. Visual: `/settings` full page + dashboard header/status bar (paused, live numeric cells masked).

E2E determinism rules: assertions only on invariants (not exact random values); waits via `expect.poll`/web-first assertions, the single fixed wait (pause stability) is ≤ 1.2 s and documented; retries = 0 locally, 1 in CI with trace on first retry (a retry that passes is reported as flaky in the job summary).

### 3.2 AAA convention

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

Rules: exactly one `// Act` section per test (one behaviour per test); `// Arrange` may be omitted if empty; no `if`/loops in tests (`vitest/no-conditional-in-test`); every test asserts (`vitest/expect-expect`); Rust tests follow the same comments.

### 3.3 Coverage thresholds (slide: 65 % / 85 %)

| Scope                                                                                                            | statements | branches | functions | lines |
| ---------------------------------------------------------------------------------------------------------------- | ---------- | -------- | --------- | ----- |
| Global (`src/app/**`, excl. `*.spec.ts`, `main.ts`, `app.config.ts`, `*.model.ts`, `producer.worker.ts` adapter) | 65         | 65       | 65        | 65    |
| Critical: `src/app/core/producer/**`, `src/app/shared/format/**`                                                 | 85         | 85       | 85        | 85    |
| Rust `wasm/producer/src/**` (cargo-llvm-cov)                                                                     | —          | —        | 85        | 85    |

Ratchet policy: thresholds may be raised, never lowered, without an explicit commit message `chore(quality): lower threshold — <reason>`.

---

## 4. Implementation phases

Each step lists **work** and a **deterministic control check** (command → exact expected result). Phase Q0 runs **before Phase 1 of the implementation plan** so that all generated code is gated from its first line; later Q-phases attach to the implementation phases noted.

### Phase Q0 — Static baseline (insert after Implementation Phase 0)

| Step  | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Control check                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q0.1  | **TypeScript strictness** in `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride` (exists), `noPropertyAccessFromIndexSignature` (exists), `forceConsistentCasingInFileNames`. `angularCompilerOptions`: `strictTemplates`, `strictInjectionParameters` (exists), `extendedDiagnostics: { defaultCategory: "error" }`. Script `lint:types` = `tsc --noEmit -p` for `tsconfig.app.json`, `tsconfig.spec.json`, `tsconfig.worker.json`, `wasm-tests/tsconfig.json`.                                                                              | `npm run lint:types` exit 0; negative probe: a temp file with `const a: string[] = []; a[0].length` fails with `TS2532` (then deleted)                  |
| Q0.2  | **ESLint**: `npx ng add angular-eslint@22` (flat `eslint.config.js`). Extend `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked` (with `parserOptions.projectService`), `angular.configs.tsRecommended`, `angular.configs.templateRecommended`, `angular.configs.templateAccessibility`. Key rules: `@typescript-eslint/no-explicit-any: error`, `no-non-null-assertion: error`, `no-floating-promises: error`, `@angular-eslint/template/prefer-control-flow`, `template/prefer-self-closing-tags`, `@angular-eslint/prefer-signals`, `no-console: error` (allow `warn`/`error`). Script `lint` = `ng lint --max-warnings 0`. | `npm run lint` exit 0 on scaffold; negative probe: `let x: any` in a temp file → `no-explicit-any` error                                                |
| Q0.3  | **Complexity limits** (ESLint): `complexity: ["error", 10]`, `max-depth: ["error", 3]`, `max-params: ["error", 4]`, `max-lines-per-function: ["error", {max: 60, skipBlankLines: true, skipComments: true}]`, `max-lines: ["error", 300]`; `sonarjs/cognitive-complexity: ["error", 15]` (`eslint-plugin-sonarjs`); templates: `@angular-eslint/template/cyclomatic-complexity: ["error", {maxComplexity: 8}]`, `template/conditional-complexity: ["error", {maxComplexity: 4}]`. Specs override: `max-lines-per-function` off, `max-lines` 600.                                                                                            | Probe file with a 12-branch function → `complexity` error; probe template with 9 nested `@if` → template rule error; `npm run lint` on real code exit 0 |
| Q0.4  | **Architecture boundaries** via `no-restricted-imports` overrides: (a) everything in `core/producer/engine/**` (the worker-side, framework-free code) must not import `@angular/*` or `rxjs`. This is a folder rule, not a file list, so new files are covered automatically; (b) `core/**` must not import `features/**`; (c) `shared/**` must not import `core/**` or `features/**`; (d) a feature must not import another feature. `no-restricted-syntax`: ban `Math.random` in `core/producer/**`; ban `@Injectable` decorator, `fixture.detectChanges`/`markForCheck` (specs), imports of `FormGroup                                   | FormControl                                                                                                                                             | FormBuilder | ReactiveFormsModule`. These **replace the grep guards** of IMPLEMENTATION_PLAN §4.0 with editor-visible lint errors (greps stay in CI as a backstop). | One probe per rule fails lint with the expected rule id, and **negative probes** confirm that allowed imports don't fire. `scripts/lint-probes.mjs` writes the probes into the real architecture folders, lints them, checks `expect`/`forbid` rule ids, then deletes them → exit 0 |
| Q0.5  | **Vitest lint** in `**/*.spec.ts`, `wasm-tests/**`: `@vitest/eslint-plugin` recommended + `no-focused-tests`, `no-disabled-tests` (error), `expect-expect`, `no-identical-title`, `no-conditional-in-test`, `no-standalone-expect`, `max-nested-describe: 2`, `consistent-test-it: it`.                                                                                                                                                                                                                                                                                                                                                     | `lint-probes` includes `it.only` and assertion-free test → expected rule ids                                                                            |
| Q0.6  | **AAA rule**: local ESLint rule `local/aaa-sections` (inline plugin in `eslint.config.js`, ~50 LOC): every `it/test` callback body must contain the comment `// Act` exactly once and `// Assert` at least once, in that order, with `// Arrange` (if present) before `// Act`. Rule has its own spec (`eslint-rules/aaa-sections.spec.ts`, ESLint `RuleTester`).                                                                                                                                                                                                                                                                           | RuleTester spec green; probe without `// Act` → `local/aaa-sections` error                                                                              |
| Q0.7  | **Duplication**: `jscpd` with `.jscpd.json`: `{"threshold": 3, "minTokens": 50, "minLines": 6, "format": ["typescript","markup","scss","rust"], "path": ["src","wasm/producer/src","wasm-tests"], "ignore": ["**/*.spec.ts","**/node_modules/**"], "reporters": ["console","html","json"], "output": "reports/jscpd", "failOnEmpty": true}` (jscpd 5). The gate is the 3 % threshold. `exitCode` (fail on any single clone) is deliberately not set. Script `dup`. Probes live in `scripts/quality-probes.mjs`.                                                                                                                             | `npm run dup` exit 0; probe: duplicate a 30-line function in a temp file under `src/` → exit 1                                                          |
| Q0.8  | **Dead code**: `knip` with `knip.json` (entry: `src/main.ts`, `src/app/**/producer.worker.ts`, `scripts/*.mjs`, `wasm-tests/**`; project: `src/**/*.ts`). Script `deadcode` = `knip --no-progress`.                                                                                                                                                                                                                                                                                                                                                                                                                                         | `npm run deadcode` exit 0; probe: unused exported function → non-zero exit                                                                              |
| Q0.9  | **Rust static**: `wasm/producer/clippy.toml` → `cognitive-complexity-threshold = 10`, `too-many-arguments-threshold = 5`; crate root `#![deny(clippy::all, clippy::pedantic)]`, `#![warn(clippy::cognitive_complexity)]`, `#![deny(unsafe_op_in_unsafe_fn)]`; `rustfmt.toml` defaults. `test:rust` already runs `clippy -D warnings` + `fmt --check`.                                                                                                                                                                                                                                                                                       | `npm run test:rust` exit 0 (from Phase 1 onward)                                                                                                        |
| Q0.10 | **Supply chain**: `npm audit --omit=dev --audit-level=high` script `audit`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | exit 0                                                                                                                                                  |
| Q0.11 | **Aggregate scripts**: `static` = `format:check && lint && lint:types && dup && deadcode && audit`; `verify:fast` = `static && test:unit`; `verify` = `static && test:rust && test:wasm && test:ci && build && e2e`.                                                                                                                                                                                                                                                                                                                                                                                                                        | `npm run static` exit 0                                                                                                                                 |

> **Status (2026-11-18):** Q0.1–Q0.8, Q0.10 and Q0.11 are done and verified. **Q0.9 (Rust clippy/rustfmt) moves into Implementation step 1.1**, because it needs the Rust toolchain and the crate. Self-test commands: `npm run quality:self-test` = `lint:probes` (20 ESLint probes, including false-positive guards) + `test:lint-rules` (AAA RuleTester) + `quality:probes` (jscpd/knip). `npm run verify` currently = static + self-test + unit tests + build, and gains stages as phases land.

**Q0 gate:** `npm run static` exit 0 **and** `node scripts/lint-probes.mjs` exit 0 (proves every rule actually fires — a silently misconfigured linter is the most common failure).

### Phase Q1 — Local & agent-loop enforcement (right after Q0)

| Step | Work                                                                                                                                                                                                                                                                                                                            | Control check                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Q1.1 | `husky` + `lint-staged`: pre-commit → `prettier --write` + `eslint --fix --max-warnings 0` on staged `*.{ts,html,scss}`; `cargo fmt` + `cargo clippy -D warnings` when `*.rs` staged.                                                                                                                                           | Stage a file with a lint error → `git commit` exits non-zero                  |
| Q1.2 | `commitlint` (`@commitlint/config-conventional`) on commit-msg, plus custom rule rejecting `/claude                                                                                                                                                                                                                             | anthropic                                                                     | co-authored-by/i` in messages. | `echo "feat: x\n\nCo-Authored-By: Claude" \| npx commitlint` exit 1; `echo "feat(core): add metrics" \| npx commitlint` exit 0 |
| Q1.3 | pre-push → `npm run verify:fast`.                                                                                                                                                                                                                                                                                               | Push with failing unit test is rejected locally                               |
| Q1.4 | **Claude Code hook** (`.claude/settings.json`, via the `update-config` skill): `PostToolUse` matcher `Edit\|Write` → `scripts/agent-lint-file.mjs "$FILE"` runs Prettier + ESLint on the edited file only (`*.ts\|*.html\|*.scss`), prints errors so the agent fixes them immediately; exit code 2 on lint errors to feed back. | Edit a file with an `any` via the agent → hook output shows `no-explicit-any` |
| Q1.5 | `CLAUDE.md` "Quality gates" section: commands, thresholds, "never disable a rule inline without a `-- reason`" (enforced by `eslint-comments/require-description` from `@eslint-community/eslint-plugin-eslint-comments` + `no-unlimited-disable`).                                                                             | Probe `// eslint-disable-next-line` without description → lint error          |

> **Status (2026-11-18):** Q1.1–Q1.5 are done and verified. `npm run hook:probes` runs real commits and pushes in a throwaway git worktree against a temporary bare remote. It checks 5 things: pre-commit blocks a lint error, pre-commit lets a clean file through, commit-msg blocks a non-conventional message, commit-msg blocks AI attribution, and pre-push blocks a failing test. The agent hook was tested live: an `any` introduced through the Edit tool came back as a blocking ESLint error. Decisions: commitlint rejects Claude/Anthropic and "Generated with …" anywhere, but allows human `Co-authored-by`; `no-restricted-disable` makes the architecture rules impossible to switch off with `eslint-disable`; `lint-staged` is pinned to 17.6.0, a release at least two weeks old.

**Q1 gate:** all four probes above behave as specified.

### Phase Q2 — Unit/integration coverage gates (attach to Implementation Phase 2; tighten through Phase 7)

| Step | Work                                                                                                                                                                                                                                                                                                                                                 | Control check                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Q2.1 | `npm i -D @vitest/coverage-v8`. `angular.json` test target: `coverage: true` in a `ci` configuration, `coverageReporters: ["text-summary","lcov","json-summary","html"]`, `coverageExclude` per §3.3, `coverageThresholds: {statements: 65, branches: 65, functions: 65, lines: 65}`. Script `test:ci` = `ng test --watch=false --configuration ci`. | `npm run test:ci` prints coverage summary; exit 0                                                                           |
| Q2.2 | **Critical-path 85 %**: `runnerConfig: "vitest-base.config.mts"` with `test.coverage.thresholds: { "src/app/core/producer/**": {statements:85,branches:85,functions:85,lines:85}, "src/app/shared/format/**": {…85} }`.                                                                                                                              | Probe: temporarily skip `metrics.spec.ts` → `test:ci` exits non-zero naming the glob                                        |
| Q2.3 | **Rust coverage**: `rust-toolchain.toml` `components = ["llvm-tools-preview","clippy","rustfmt"]`; `cargo install cargo-llvm-cov` (CI: `taiki-e/install-action`); script `cov:rust` = `cargo llvm-cov --manifest-path wasm/producer/Cargo.toml --fail-under-lines 85 --fail-under-functions 85 --lcov --output-path reports/rust.lcov`.              | `npm run cov:rust` exit 0                                                                                                   |
| Q2.4 | Integration tests I1–I3 (§3.1) written with the implementation phases 3–6; Node-environment integration (I1) runs in `wasm-tests/vitest.config.mts` project.                                                                                                                                                                                         | Named tests present: `npx ng test --watch=false --list-tests \| grep -c integration` ≥ 2; `npm run test:wasm` lists I1 + I4 |

> **Q0.9 status (2026-11-18, delivered with Implementation step 1.1):**
>
> - **Lint policy:** the Cargo `[lints]` table denies `clippy::all` and `clippy::pedantic`, plus `unwrap_used`/`expect_used`/`panic`/`todo` outside tests (Wasm uses `panic = "abort"`, so a panic would trap the worker).
> - **Thresholds** are in `clippy.toml`: cognitive complexity **7**, nesting **4**, at most 60 lines and 4 arguments per function.
> - **Recalibration:** the cognitive limit was lowered from the planned 10 to 7. A probe showed clippy's score has no nesting weight; a function 3 loops deep with compound conditions scored only 9, so `excessive_nesting` was added as well.
> - **Probes:** 7 Rust probes in `quality-probes.mjs` run on a temporary copy of the crate and read the exact lint codes from cargo's JSON output.
> - **Hooks:** Rust runs in lint-staged and in `verify:fast`/`verify`.

> **Supply-chain gate (added 2026-11-18, during step 2.1):**
>
> - **What triggered it:** installing `@vitest/coverage-v8` showed the scaffold's `^5.0.0` range had resolved Vitest to **5.1.1, published that same morning**. 15 of the 28 direct dependencies were under 14 days old, including 3 pins I had chosen myself.
> - **Fix:**
>   - every direct dependency is pinned exactly to a release at least 14 days old (Angular 22.2.4/22.2.5, angular-eslint 22.6.0, eslint 10.14.0, jscpd 5.4.2, knip 6.44.1, prettier 3.9.10, vitest 5.1.0);
>   - the lockfile was re-resolved with `npm install --before=2026-11-04`, so **transitive** dependencies are at least 14 days old as well;
>   - `.npmrc` sets `save-exact=true`.
> - **Gate:** `npm run deps:age` (in `static`) fails on a range, a release under 14 days old, or a lockfile that drifted from the pin. Its failure message names the version to use.
> - **Probes:** 4 in `quality-probes.mjs`. `DEPS_AGE_NOW` pins the date, so they give the same result forever.

> **Q2.1 + Q2.2 status (2026-11-18): done, in one commit because they share the same two files.**
>
> - **Setup:** `angular.json` test target, configuration `ci`, runs through `npm run test:ci`.
>   - `coverage: true`, with reporters `text-summary`, `lcov`, `json-summary` and `html` writing to `coverage/findev`.
>   - **`coverageInclude: ["src/app/**/*.ts"]`**, so files that no test loads still count. `app.routes.ts` immediately showed up at 0 %.
>   - `coverageExclude` per §3.3: specs, `*.model.ts`, `app.config.ts`, `producer.worker.ts`.
>   - Global floor of 65 % on all four measures.
>   - `runnerConfig: vitest-base.config.mts` adds the **85 %** per-glob floors for `src/app/core/producer/**` and `src/app/shared/format/**`. The builder's own `coverageThresholds` cannot express globs.
> - **Results today:** 99.24 % statements, 99.1 % branches, 100 % functions, 99.06 % lines.
> - **Probes (in `quality-probes.mjs`)** add one throwaway untested file sized so that **exactly one** floor breaks:
>   - 30 lines in `core/producer` give 72 % against the glob limit, with no global message;
>   - 200 lines elsewhere give 34 % against the global limit, with no glob message.
>   - Each probe forbids the other message, so a probe that broke both floors at once (my first draft) counts as a failure.
> - **Probe deviation:** the plan suggested skipping `metrics.spec.ts`. I add a file instead, so no real file is touched.
> - **Wiring:** `verify:fast` (pre-push) and `verify` now run `test:ci` in place of `test:unit`.

> **Q2.3 status (2026-11-18): done.**
>
> - **Tool:** `cargo-llvm-cov` **0.9.1**, 72 days old, installed with `cargo +1.99.0 install … --locked`. rustup has no global default here; only `rust-toolchain.toml` selects one, so the toolchain is named explicitly rather than changing the machine-wide default.
> - **`npm run cov:rust`:** a `--summary-only` gate with `--fail-under-lines 85 --fail-under-functions 85`, then `llvm-cov report --lcov` → `reports/rust.lcov` for CI (Q4).
> - **Results today:** 99.83 % lines, 100 % functions, 99.69 % regions.
> - **Caveat:** tests are inline `#[cfg(test)]` modules, which llvm-cov counts, so the numbers run slightly high. The mutation check (`test:rust:mutants`) is the stronger signal for Rust test quality.
> - **Probes:**
>   - 20 untested public functions give functions 82.76 % → exit 1.
>   - The unchanged crate → exit 0.
>   - The probes read the thresholds **from the `cov:rust` script itself**, so lowering them in `package.json` also changes what is probed.
>   - llvm-cov prints no message on a miss; the probe requires exit 1 plus a printed `TOTAL` row, which tells it apart from a compile error (exit 101).
> - **Wiring:** runs in `verify`, not in `verify:fast`, because the instrumented rebuild is slower.

**Q2 gate:** `npm run test:ci && npm run cov:rust && npm run test:wasm` exit 0.

### Phase Q3 — E2E, accessibility, visual (attach after Implementation Phase 7)

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Control check                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Q3.1 | `npm init playwright@latest` (TypeScript, `e2e/`, Chromium only, no GH workflow — we own CI). `playwright.config.ts`: `webServer: { command: "npm run build && npx ng serve --configuration production --port 4300", url: "http://localhost:4300", reuseExistingServer: !process.env.CI }`, `use.baseURL` from `E2E_BASE_URL` or localhost, `retries: CI ? 1 : 0`, `trace: "on-first-retry"`, `forbidOnly: !!CI`, reporters `list` + `html` (`reports/playwright`). | `npx playwright test --list` shows the planned specs                                                                     |
| Q3.2 | E2E specs 1–5 (§3.1) using role/label locators (`getByRole('row')`, `getByRole('button', {name: 'Pause'})`) — no CSS selectors on implementation details. AAA comments apply.                                                                                                                                                                                                                                                                                       | `npm run e2e` exit 0, total < 90 s                                                                                       |
| Q3.3 | `@axe-core/playwright` spec 6: `new AxeBuilder({page}).withTags(['wcag2a','wcag2aa']).analyze()` → filter `serious`/`critical` → expect `[]`.                                                                                                                                                                                                                                                                                                                       | exit 0                                                                                                                   |
| Q3.4 | Visual spec 7: `expect(page).toHaveScreenshot('settings.png', {maxDiffPixelRatio: 0.01})`; dashboard: pause first, `mask: [page.getByTestId('metric-cell')]`. Baselines generated **in the CI image** for deterministic rendering: script `e2e:update-snapshots` = `docker run --rm -v $PWD:/w -w /w mcr.microsoft.com/playwright:v<pinned>-noble npx playwright test --update-snapshots --grep @visual`. Snapshots committed under `e2e/__screenshots__/`.         | Change a heading colour → visual test fails with a diff image highlighting the region (the "red panel"); revert → passes |
| Q3.5 | Post-deploy smoke: same Playwright project with `E2E_BASE_URL=https://vvitkus-dev.github.io/findev/ --grep @smoke` (specs 1 and 5 tagged `@smoke`).                                                                                                                                                                                                                                                                                                                 | CI `smoke` job green after deploy                                                                                        |

**Q3 gate:** `npm run e2e` exit 0 locally and in CI; flaky count = 0 over 3 consecutive CI runs.

### Phase Q4 — CI integration, pyramid & PR hygiene (merge into Implementation Phase 8)

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Control check                                                                                                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Q4.1 | **Pyramid check** `scripts/test-pyramid.mjs`: counts tests from Vitest JSON reporter output (unit vs `*.integration.spec.ts`), Rust (`cargo test -- --list`), Playwright (`--list --reporter json`). Asserts: `e2e / total ≤ 0.10`, `unit / total ≥ 0.60`, `integration ≥ 3`. Prints the pyramid as a table into `$GITHUB_STEP_SUMMARY`.                                                                                                                                                                                                                                                                             | Script exit 0; probe: fake report with 50 % E2E → exit 1 ("ice-cream cone detected")                                                            |
| Q4.2 | **CI workflow** `.github/workflows/ci-deploy.yml` restructured into jobs: `static` (Q0 scripts + clippy/fmt + commitlint on pushed range + legacy grep guards) ∥ `test` (`test:ci`, `test:rust`, `cov:rust`, `wasm:build`, `wasm:verify`, `test:wasm`, `test-pyramid`) → `e2e` (needs `test`; Playwright container `mcr.microsoft.com/playwright:v<pinned>-noble`) → `deploy` (needs **static, test, e2e**; `main` only) → `smoke` (needs deploy). Artifacts: `reports/coverage`, `reports/jscpd`, `reports/playwright`, `reports/rust.lcov`. Coverage + duplication + pyramid summaries written to the job summary. | Push a commit with a lint error to a branch → `static` red, `deploy` skipped; fix → all green; on `main` deploy runs only after all three gates |
| Q4.3 | **PR hygiene** for big AI PRs: `.github/pull_request_template.md` (what/why, test evidence, checklist mirroring gates); job `pr-size` (pull_request only) fails if changed lines > 600 excluding `package-lock.json`, `e2e/__screenshots__/**`, `.claude/skills/**` (message: "split the PR").                                                                                                                                                                                                                                                                                                                       | Synthetic PR > 600 lines → `pr-size` red                                                                                                        |
| Q4.4 | README "Quality gates" section: table of controls, thresholds, commands, how to update visual baselines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | README contains each script name from Q0.11 (grep check)                                                                                        |

**Q4 gate:** three consecutive green CI runs on `main` with deploy; a deliberately broken branch shows the expected red job for each gate type (static/test/e2e).

### Phase Q5 — Stretch (only if time allows; good interview talking points)

| Step | Work                                                                                                                                                                                                                                                                                      | Control check                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Q5.0 | ✅ **Pulled forward for Rust:** `scripts/rust-mutants.mjs`, a dependency-free mutation check (string mutants applied to a temporary copy of the crate, which must make `cargo test` fail). It runs in `npm run verify`. Every new Rust module adds its mutants.                           | `npm run test:rust:mutants` → "All N mutants killed" |
| Q5.1 | **Mutation testing**: StrykerJS + `@stryker-mutator/vitest-runner` on `core/producer/{metrics,producer-settings}.ts` and `shared/format/market-format.ts` via a Node-env Vitest project. `thresholds: {high: 90, low: 80, break: 80}`. Weekly/scheduled CI job (too slow for every push). | `npx stryker run` mutation score ≥ 80 %              |
| Q5.2 | **SonarCloud** (free for public repos) fed with lcov + ESLint JSON: single dashboard for complexity, duplication, coverage on new code. Local tools remain the source of truth (no external dependency for gating).                                                                       | Quality Gate "Passed" badge in README                |

---

## 5. Thresholds summary (single source of truth)

| Metric                                         | Threshold                                | Tool                                                      |
| ---------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| TS errors                                      | 0                                        | `tsc`, `ngc` (strictTemplates, extendedDiagnostics=error) |
| Lint warnings/errors                           | 0 (`--max-warnings 0`)                   | ESLint                                                    |
| Cyclomatic complexity / function               | ≤ 10                                     | ESLint `complexity`                                       |
| Cognitive complexity / function                | ≤ 15                                     | `sonarjs/cognitive-complexity`                            |
| Template cyclomatic / conditional complexity   | ≤ 8 / ≤ 4                                | angular-eslint template rules                             |
| Rust cognitive complexity                      | ≤ 10                                     | clippy                                                    |
| Function length / file length / params / depth | ≤ 60 lines / ≤ 300 lines / ≤ 4 / ≤ 3     | ESLint                                                    |
| Duplication                                    | ≤ 3 % (min 50 tokens)                    | jscpd                                                     |
| Unused files/exports/deps                      | 0                                        | knip                                                      |
| Coverage global / critical / Rust              | ≥ 65 % / ≥ 85 % / ≥ 85 %                 | v8, cargo-llvm-cov                                        |
| Pyramid                                        | E2E ≤ 10 %, unit ≥ 60 %, integration ≥ 3 | `test-pyramid.mjs`                                        |
| E2E a11y                                       | 0 serious/critical                       | axe                                                       |
| Visual diff                                    | ≤ 1 % pixels                             | Playwright                                                |
| PR size                                        | ≤ 600 changed lines                      | `pr-size` job                                             |
| Mutation score (stretch)                       | ≥ 80 %                                   | Stryker                                                   |

## 6. Risks & mitigations

| Risk                                                   | Mitigation                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Strict lint/complexity slows early development         | Rules are on from day 0 (cheap to comply with fresh code, expensive to retrofit); `lint --fix` in hooks |
| Coverage gamed by assertion-free AI tests              | `expect-expect`, AAA rule, mutation testing (Q5.1)                                                      |
| Visual tests flaky across OS/fonts                     | Baselines only from pinned Playwright Linux image; only stable regions; live numbers masked             |
| E2E timing flakiness with a live worker                | Assertions on invariants + `expect.poll`; single bounded wait; CI retry=1 with flaky reporting          |
| CI duration growth                                     | Parallel `static` ∥ `test`; npm/cargo/Playwright caches; E2E Chromium-only                              |
| Tool version drift (Angular 22 / ESLint 10 / Vitest 5) | Pin exact versions in `package.json`; every Q-step verified by its probe immediately after install      |
