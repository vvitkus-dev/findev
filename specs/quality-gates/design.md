# Quality Gates — Design

> Spec phase 2 of 3 · Previous: [requirements.md](requirements.md) · Next: [tasks.md](tasks.md)

```mermaid
flowchart LR
  A["Agent hook<br/>per edited file"] --> C["pre-commit<br/>lint-staged · commitlint"]
  C --> P["pre-push<br/>verify:fast"]
  P --> CI["CI<br/>static ∥ self-test ∥ test → e2e"]
  CI --> D["deploy<br/>main only, all gates green"]
  D --> S["smoke<br/>live URL"]
```

## 1. Design decisions

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

## 2. Gate matrix (where each control runs)

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

## 3. Test specification

### 3.1 Layers

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

Rules: exactly one `// Act` per test (one behaviour per test); `// Arrange` may be omitted when
empty; no `if`/loops in tests; every test asserts; Rust tests use the same comments.

### 3.3 Coverage scopes

| Scope                                                                                                            | statements | branches | functions | lines |
| ---------------------------------------------------------------------------------------------------------------- | ---------- | -------- | --------- | ----- |
| Global (`src/app/**`, excl. `*.spec.ts`, `main.ts`, `app.config.ts`, `*.model.ts`, `producer.worker.ts` adapter) | 65         | 65       | 65        | 65    |
| Critical: `src/app/core/producer/**`, `src/app/shared/format/**`                                                 | 85         | 85       | 85        | 85    |
| Rust `wasm/producer/src/**` (cargo-llvm-cov)                                                                     | —          | —        | 85        | 85    |

---

## 4. Risks and mitigations

| Risk                                           | Mitigation                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Strict lint/complexity slows early development | Rules are on from day 0 (cheap for fresh code, expensive to retrofit); `--fix` in hooks          |
| Coverage gamed by assertion-free AI tests      | `expect-expect`, AAA rule, mutation testing (QG-16)                                              |
| Visual tests flaky across OS/fonts             | Baselines only from the pinned Playwright Linux image; stable regions only; live numbers masked  |
| E2E timing flakiness with a live worker        | Assertions on invariants + `expect.poll`; bounded fixed waits; CI retry = 1 with flaky reporting |
| CI duration growth                             | Parallel `static` ∥ `self-test` ∥ `test`; npm/cargo/Playwright caches; Chromium only             |
| Tool or dependency drift                       | Exact pins ≥ 14 days old (QG-10); every step verified by its probe right after install           |
