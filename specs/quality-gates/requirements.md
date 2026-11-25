# Quality Gates — Requirements

> Spec phase 1 of 3 · Next: [design.md](design.md) · [tasks.md](tasks.md)
>
> Applies to every change in the repo, including all of [market-dashboard](../market-dashboard/requirements.md).

## Introduction

**User story:** As a reviewer of AI-generated code, I want every deterministic check to run
automatically and block the change when it fails, so that my review can focus on design and
intent instead of style, gaps and regressions.

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
| QG-17 | The suite **SHALL** have unit, integration and E2E layers ([design §3.1](design.md#31-layers)).                                                 | integration ≥ 3                                              | `npm run test:pyramid`               | Q2.4, Q3.2 | ✅     |
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
