# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Interview take-home: a realtime fintech dashboard. An Angular app has two pages, a live market Dashboard and producer Settings. Simulated market updates come from a **candidate-written Wasm library (Rust)**, which runs inside a **Web Worker**.

`docs/IMPLEMENTATION_PLAN.md` is the source of truth. It holds the requirement IDs (R1–R24), the architecture decisions with their trade-offs, the exact interfaces (Wasm ABI, worker protocol, metrics, service), and the phased steps. Each step has deterministic control checks. Work phase by phase. A step is done only when its control checks pass. Commit once per step, using conventional commits.

The repo is currently at **Phase 0**: a fresh Angular 22 scaffold. Paths and scripts marked _(planned)_ below do not exist yet. They are created by the plan steps named next to them.

## Stack

- Angular 22.2: standalone, **zoneless** (there is no zone.js and no `provideZoneChangeDetection`), signals, `@angular/build:application` (esbuild).
- TypeScript 6.0. Vitest 5 runs through `@angular/build:unit-test` with jsdom (no Karma, no `vitest.config` for app tests).
- Node 24 (`.nvmrc`), npm 11.
- Rust stable on `wasm32-unknown-unknown`, pinned by `rust-toolchain.toml` _(planned, step 0.2)_. Rust is **not installed locally yet**.

## Commands

```bash
npm start                    # ng serve, http://localhost:4200
npm run build                # production build → dist/findev/browser
npm run test:unit            # all Angular unit tests once (Vitest)
npx ng test --watch=false --include src/app/core/producer/engine/metrics.spec.ts   # single file
npx ng test --watch=false --filter '^Metrics'                                       # by suite/test name regex

npm run verify:fast          # static + unit tests (pre-push hook runs this)
npm run verify               # full gate: static + quality self-test + unit tests + build
npm run static               # format:check, lint, lint:types, dup (jscpd), deadcode (knip), audit
npm run lint                 # ng lint --max-warnings 0 (TS + templates)
npm run format               # prettier --write .
npm run quality:self-test    # proves the gates still fire: lint/quality/hook probes + AAA RuleTester
```

_(planned)_ These scripts join `verify` as the phases land: `wasm:build` and `wasm:verify` (step 1.6); `test:rust` (cargo test + clippy + fmt) and `cov:rust` (step 1.1 / Q2.3); `test:wasm` (Node Vitest on the compiled `.wasm`, step 2.5); `test:ci` (coverage thresholds, Q2.1); `e2e` (Playwright, Q3).

## Architecture (target, see plan §1–§3)

Data flow: `Rust producer (Wasm)` → `ProducerEngine in worker (TS)` → snapshots via `postMessage` → `ProducerStore` (`@Service()` singleton, signals) → pages.

- **Wasm ABI is raw C ABI, not wasm-bindgen.** `producer_generate` writes `n` records of 7 little-endian `u32` words into Wasm memory: `[instrument, priceCents, tradeQty, bidCents, askCents, bidQty, askQty]`. JS reads them through a `Uint32Array` view. That view **must be re-created after every `generate` call**, because memory growth detaches the old buffer. The exports are fixed and checked by `scripts/verify-wasm.mjs`. Bump `abi_version` on any layout change.
- **All randomness and price logic lives in Rust** (seeded SplitMix64 → PCG32, no crates). The only thing TS does is produce the seed, via `crypto.getRandomValues` in `ProducerStore`. Producer code must never call `Math.random`.
- **Metrics are split.** The worker accumulates raw sums with `applyBatch`: last price, latest quote/book, `volume = Σqty`, `notionalCents = Σprice×qty`. The main thread calculates spread, VWAP and imbalance with the pure `deriveMetrics`, which returns `null` when a denominator is zero. All prices stay as integer cents, rounded only in `shared/format/market-format.ts` (pure functions wrapped by pure pipes). No event history is kept; state is O(instruments).
- **Run isolation.** Every command and snapshot carries a `runId`. Both the worker and `ProducerStore` drop messages whose `runId` does not match. **Apply** increments `runId`, resets rows synchronously, and the worker destroys the old Wasm generator before creating the new one.
- **One worker for the whole app.** It is created once in `ProducerStore.boot()` through the `WORKER_FACTORY` token and terminated when the root injector is destroyed. Navigation must never create a worker; `new Worker` appears only in the `WORKER_FACTORY` default in `producer-tokens.ts`. The worker is re-created only by `retry()` after a fatal error.
- **`core/producer/engine/` is framework-free** (lint-enforced): no `@angular/*` or `rxjs` imports, because it runs in the worker and in Node tests.
- **Testability through injection.** `ProducerEngine` is pure TS and takes injected `loadFactory`, `Scheduler`, `Clock` and `post`. `producer.worker.ts` is only a thin adapter around it. Tests use `ManualScheduler`, a fake generator factory, `FakeWorker` and fixed seeds. **Tests must never sleep or wait on real time.**
- **Scheduling.** The worker reschedules itself with `setTimeout`, delayed by `max(0, interval − elapsed)`. There is no `setInterval` and no catch-up after a pause or a slow batch. A batch generated before Pause but delivered after it is still accepted, because it has the same `runId`.
- **Wasm URL.** The main thread resolves it from `document.baseURI` and sends it in the `init` message, because the app is deployed under a `/<repo>/` sub-path.

## Deployment _(planned, Phase 8)_

GitHub Pages via GitHub Actions (`.github/workflows/ci-deploy.yml`):

- **Every push** builds and runs all tests.
- **Only pushes to `main`** deploy. The deploy build runs `ng build --base-href "/findev/"` and copies `index.html` to `404.html` as the SPA fallback.
- Repo: https://github.com/vvitkus-dev/findev. A push to `main` redeploys the live demo; there are no manual deploy steps.

## Angular coding: always use the `angular-developer` skill

**Before writing or changing any Angular code** (components, services, DI, signals, forms, routing, pipes, styles, Angular tests), invoke the project skill `angular-developer` (`.claude/skills/angular-developer/SKILL.md`) and read the `references/*.md` files the task needs. The skill is Angular's official agent skill (https://angular.dev/ai/agent-skills). It is pinned in `skills-lock.json`; restore it with `npx skills experimental_install` and update it with `npx skills update angular-developer -p`. Don't edit the skill files by hand.

Plan §4.0 lists the skill rules this repo applies. The ones most often missed:

- **Naming is "Intent over Role"** (v20+, matching the scaffold's `app.ts`/`class App`): `metrics-table.ts` → `class MetricsTable`, `producer-store.ts` → `class ProducerStore`. No `.component.ts`/`.service.ts` suffixes and no `Component`/`Service` class suffixes. Types go in `*.model.ts`.
- **Services:** `@Service()`, not `@Injectable({providedIn:'root'})`. Private writable signals are exposed with `.asReadonly()` or `computed()`. Use `inject()`.
- **Components:** OnPush is the v22 default, so don't set `changeDetection`. Use `input()`/`output()`, `@if/@for/@switch` (`track` is required), and self-closing tags. No expensive calls in templates: use `computed()` or pure pipes.
- **Forms:** use **Signal Forms** (`@angular/forms/signals`: `form`, `[formField]`, schema validators, `submit(form, async () => …)`), not Reactive Forms. Never put `null` in the form model. Never put `min`/`max`/`[value]`/`[disabled]` attributes on a `[formField]` input. Settings limits come only from `SETTINGS_LIMITS` in `core/producer/engine/producer-settings.ts`.
- **Tests:** zoneless Act → `await fixture.whenStable()` → Assert. Never call `fixture.detectChanges()` or `markForCheck()`. Set inputs with `fixture.componentRef.setInput()`. Use `RouterTestingHarness` with the real routes; don't mock the Router.
- **Scaffold** with `ng generate …`, and run `npx ng build` after every Angular change. The skill requires a clean build before you continue.

The plan §4.0 guard greps are now ESLint rules (Q0.4), so `npm run lint` covers them.

## Quality gates (`docs/QUALITY_GATES_PLAN.md`)

All thresholds are hard failures, and deploy is blocked unless every gate is green. Where each one runs:

- **On every edit I make:** a Claude Code `PostToolUse` hook (`.claude/settings.json` → `scripts/agent-lint-file.mjs`) formats and lints the file. When it reports ESLint errors, fix them before doing anything else.
- **On commit:** lint-staged (Prettier + ESLint on staged files) and commitlint. Messages must be conventional commits, and they **must not mention Claude/Anthropic** or carry AI attribution lines.
- **On push:** `npm run verify:fast`.
- **In CI:** everything above plus coverage, E2E and the pyramid check. _(planned, Q4)_

Never bypass these with `--no-verify`.

The architecture rules are lint rules, so `eslint-disable` can't switch them off: import boundaries, `engine/` staying framework-free, the bans on `Math.random` / `@Injectable` / Reactive Forms / `detectChanges`, the AAA rule, and `.only`/`.skip`. When you add a new gate rule, add a probe to `scripts/lint-probes.mjs` (or to `quality-probes.mjs` / `hook-probes.mjs`) that proves it fires.

- **Errors and warnings:** 0 TS errors (strict + `strictTemplates`); ESLint `--max-warnings 0`.
- **Complexity:** cyclomatic ≤ 10, cognitive ≤ 15, template cyclomatic ≤ 8.
- **Size:** function ≤ 60 lines, file ≤ 300 lines.
- **Duplication and dead code:** jscpd duplication ≤ 3 %; knip finds no unused code.
- **Coverage:** ≥ 65 % global; ≥ 85 % in `core/producer/**`, `shared/format/**` and Rust.
- **Testing pyramid:** E2E ≤ 10 % of tests and unit ≥ 60 %. Integration tests are `*.integration.spec.ts`; E2E (Playwright) lives in `e2e/`.
- **Tests use AAA:** `// Arrange`, `// Act` (exactly once), `// Assert` comments, enforced by the `local/aaa-sections` lint rule. Angular's `await fixture.whenStable()` belongs to the Act section.
- **Never weaken a gate to make code pass.** Don't lower thresholds, and every `eslint-disable` needs a `-- reason`. Fix the code or split it.

## Conventions

- Commit author email is `valery.vitkus@gmail.com`, set in the global git config.
