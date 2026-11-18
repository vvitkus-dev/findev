# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Interview take-home: a realtime fintech dashboard. An Angular app has two pages, a live market Dashboard and producer Settings. Simulated market updates come from a **candidate-written Wasm library (Rust)**, which runs inside a **Web Worker**.

`docs/IMPLEMENTATION_PLAN.md` is the source of truth. It holds the requirement IDs (R1–R24), the architecture decisions with their trade-offs, the exact interfaces (Wasm ABI, worker protocol, metrics, service), and the phased steps. Each step has deterministic control checks. Work phase by phase. A step is done only when its control checks pass. Commit once per step, using conventional commits.

The repo is currently at **Phase 0**: a fresh Angular 22 scaffold. Paths and scripts marked *(planned)* below do not exist yet. They are created by the plan steps named next to them.

## Stack

- Angular 22.2: standalone, **zoneless** (there is no zone.js and no `provideZoneChangeDetection`), signals, `@angular/build:application` (esbuild).
- TypeScript 6.0. Vitest 5 runs through `@angular/build:unit-test` with jsdom (no Karma, no `vitest.config` for app tests).
- Node 24 (`.nvmrc`), npm 11.
- Rust stable on `wasm32-unknown-unknown`, pinned by `rust-toolchain.toml` *(planned, step 0.2)*. Rust is **not installed locally yet**.

## Commands

```bash
npm start                                   # ng serve, http://localhost:4200
npm run build                               # production build → dist/findev/browser
npx ng test --watch=false                   # all Angular unit tests (Vitest)
npx ng test --watch=false --include src/app/core/producer/metrics.spec.ts   # single file
npx ng test --watch=false --filter '^Metrics'                                # by suite/test name regex
npx ng test --watch=false --coverage
```

*(planned, step 0.5)* These package scripts are defined in Phase 0. Use them once they exist:
- `npm run wasm:build`: cargo release build, then copies the output to `public/wasm/producer.wasm` (git-ignored). `prestart` and `prebuild` run it.
- `npm run wasm:verify`: checks the export names, `abi_version`, and the size budget.
- `npm run test:rust`: `cargo test` + `clippy -D warnings` + `fmt --check` for `wasm/producer`.
- `npm run test:wasm`: Vitest in a **Node** environment (`wasm-tests/vitest.config.ts`) that runs the *compiled* `.wasm` through the TS adapter.
- `npm run verify`: the global gate (type-check, Rust tests, Wasm tests, Angular tests, build). It must pass before any push.

## Architecture (target, see plan §1–§3)

Data flow: `Rust producer (Wasm)` → `ProducerEngine in worker (TS)` → snapshots via `postMessage` → `ProducerService` (root, signals) → pages.

- **Wasm ABI is raw C ABI, not wasm-bindgen.** `producer_generate` writes `n` records of 7 little-endian `u32` words into Wasm memory: `[instrument, priceCents, tradeQty, bidCents, askCents, bidQty, askQty]`. JS reads them through a `Uint32Array` view. That view **must be re-created after every `generate` call**, because memory growth detaches the old buffer. The exports are fixed and checked by `scripts/verify-wasm.mjs`. Bump `abi_version` on any layout change.
- **All randomness and price logic lives in Rust** (seeded SplitMix64 → PCG32, no crates). The only thing TS does is produce the seed, via `crypto.getRandomValues` in `ProducerService`. Producer code must never call `Math.random`.
- **Metrics are split.** The worker accumulates raw sums with `applyBatch`: last price, latest quote/book, `volume = Σqty`, `notionalCents = Σprice×qty`. The main thread calculates spread, VWAP and imbalance with the pure `deriveMetrics`, which returns `null` when a denominator is zero. All prices stay as integer cents, rounded only in the formatters. No event history is kept; state is O(instruments).
- **Run isolation.** Every command and snapshot carries a `runId`. Both the worker and `ProducerService` drop messages whose `runId` does not match. **Apply** increments `runId`, resets rows synchronously, and the worker destroys the old Wasm generator before creating the new one.
- **One worker for the whole app.** It is created once in `ProducerService.boot()` through the `WORKER_FACTORY` token and terminated when the root injector is destroyed. Navigation must never create a worker; `new Worker` appears only in `worker-factory.ts`. The worker is re-created only by `retry()` after a fatal error.
- **Testability through injection.** `ProducerEngine` is pure TS and takes injected `loadFactory`, `Scheduler`, `Clock` and `post`. `producer.worker.ts` is only a thin adapter around it. Tests use `ManualScheduler`, a fake generator factory, `FakeWorker` and fixed seeds. **Tests must never sleep or wait on real time.**
- **Scheduling.** The worker reschedules itself with `setTimeout`, delayed by `max(0, interval − elapsed)`. There is no `setInterval` and no catch-up after a pause or a slow batch. A batch generated before Pause but delivered after it is still accepted, because it has the same `runId`.
- **Wasm URL.** The main thread resolves it from `document.baseURI` and sends it in the `init` message, because the app is deployed under a `/<repo>/` sub-path.

## Deployment *(planned, Phase 8)*

GitHub Pages via GitHub Actions (`.github/workflows/ci-deploy.yml`):
- **Every push** builds and runs all tests.
- **Only pushes to `main`** deploy. The deploy build runs `ng build --base-href "/findev/"` and copies `index.html` to `404.html` as the SPA fallback.
- Repo: https://github.com/vvitkus-dev/findev. A push to `main` redeploys the live demo; there are no manual deploy steps.

## Conventions

- Use typed Reactive Forms (`NonNullableFormBuilder`), not Signal Forms. Settings limits come only from `SETTINGS_LIMITS` in `core/producer/settings.ts`.
- Use OnPush components and signal inputs (`input()`), and `@for … track`.
- Commit author email: `valery.vitkus@gmail.com`, set in the global git config.
