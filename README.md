# Findev — Realtime Market Dashboard

An Angular 22 app showing live per-instrument market metrics. The simulated market updates are
produced by a **Rust library compiled to WebAssembly**, which runs inside a **Web Worker** so the UI
thread only renders.

- **Live demo:** https://vvitkus-dev.github.io/findev/ (redeployed on every push to `main`; the
  footer shows the deployed commit)
- **Repository:** https://github.com/vvitkus-dev/findev
- **Detailed plan and decision log:** [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md),
  quality gates in [`docs/QUALITY_GATES_PLAN.md`](docs/QUALITY_GATES_PLAN.md)

Two pages:

- **Dashboard:** one row per instrument with last price, spread, volume, VWAP and order-book
  imbalance, plus the producer state, nominal vs measured throughput and Pause/Resume.
- **Settings:** instruments (1–50), updates per batch (1–1000) and batch interval (50–2000 ms),
  validated as you type. **Apply** starts a new run and resets the dashboard; editing alone
  changes nothing.

## Architecture

```mermaid
flowchart LR
  subgraph Main["Main thread (Angular, zoneless, signals)"]
    Pages["Dashboard / Settings pages"]
    Store["ProducerStore<br/>signals · runId gate · deriveMetrics"]
    Pages -- "apply / pause / resume / retry" --> Store
    Store -- "rows, status, stats (signals)" --> Pages
  end
  subgraph Worker["Web Worker"]
    Engine["ProducerEngine<br/>setTimeout scheduling · applyBatch"]
    Wasm["producer.wasm (Rust)<br/>seeded PCG32 · price/book model"]
    Engine -- "producer_generate(n)" --> Wasm
    Wasm -- "n × 7 u32 records in linear memory" --> Engine
  end
  Store -- "init / start{runId, settings, seed} / pause / resume / dispose" --> Engine
  Engine -- "snapshot{runId, seq, accumulators} / status / error" --> Store
```

1. **Rust (`wasm/producer`)** owns all randomness and price logic: a seeded SplitMix64 → PCG32 RNG
   and a mid/spread/book random walk with the invariant `0 < bid < ask`. It exports a raw C ABI
   (no wasm-bindgen): `producer_generate` writes `n` records of 7 little-endian `u32` words,
   `[instrument, priceCents, tradeQty, bidCents, askCents, bidQty, askQty]`, into linear memory.
2. **The worker (`core/producer/engine`, framework-free TypeScript)** reads the records through a
   `Uint32Array` view (re-created after every call, because memory growth detaches the old
   buffer) and folds them into O(instruments) running sums. It posts one small snapshot per batch.
3. **The main thread (`ProducerStore`)** keeps only the latest snapshot, drops anything from an
   old run, and derives the displayed metrics with the pure `deriveMetrics`. OnPush components
   re-render only the bound text.

### Decisions and trade-offs

| Decision                   | Chosen                                                       | Why, and what was rejected                                                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wasm language              | Rust, `wasm32-unknown-unknown`                               | Tiny output (< 64 KB, checked), native `cargo test`. AssemblyScript reads as "TS in Wasm"; Emscripten is heavy.                                                                                                                                                                              |
| JS ↔ Wasm interface        | Raw C ABI + `Uint32Array` view                               | Zero copies, zero glue, explainable byte by byte. wasm-bindgen adds generated glue and copies arrays.                                                                                                                                                                                        |
| Batch format               | Array of structs, 7 × `u32` (28 B/update)                    | One pointer, one view. JS objects per update would mean 20 000 allocations/s.                                                                                                                                                                                                                |
| Where metrics are computed | Sums in the worker, derivation on the main thread            | The UI thread never sees raw batches; stale runs are dropped whole. Both halves are pure, unit-tested functions.                                                                                                                                                                             |
| Worker lifecycle           | One worker per app, one Wasm generator per run               | Navigation can never create a producer; Apply is cheap. A new worker is created only by Retry after a fatal error.                                                                                                                                                                           |
| Scheduling                 | Worker-side `setTimeout`, delay `max(0, interval − elapsed)` | No overlapping ticks and no catch-up bursts after a pause or a throttled tab. `setInterval` was rejected for both.                                                                                                                                                                           |
| Run isolation              | `runId` on every command and snapshot, checked on both sides | Apply resets the rows synchronously; a late snapshot from the old run can never leak into the new one.                                                                                                                                                                                       |
| Repaints on slow devices   | Adaptive: full rate, or 10/s after repeated slow repaints    | Snapshots are cumulative, so skipping one loses no data. Only frames that render a repaint are judged, so start-up or GC jank never throttles. Leaves after 3 s of fast repaints, with backoff on quick relapses. Fixed throttling was rejected: fast devices would lose detail for nothing. |
| State                      | `@Service()` store with signals                              | Idiomatic zoneless Angular 22. NgRx is heavy for one feature.                                                                                                                                                                                                                                |
| Forms                      | Signal Forms with a validation schema                        | The v22 recommendation for new forms; limits come only from `SETTINGS_LIMITS`.                                                                                                                                                                                                               |
| Hosting                    | GitHub Pages via GitHub Actions                              | Same platform as the repo, Rust and Node on one runner. Needs `--base-href /findev/`, one HTML page per route (deep links answer 200) and a `404.html` fallback.                                                                                                                             |

## Data model and formulas

The worker keeps, per instrument: last trade price, latest bid/ask quote and book quantities,
`volume = Σ tradeQty` and `notional = Σ priceCents × tradeQty`. No event history is kept.

| Metric    | Formula                                        | Shown as "—" when                      |
| --------- | ---------------------------------------------- | -------------------------------------- |
| Last      | price of the latest trade                      | no trade yet                           |
| Spread    | `ask − bid`                                    | no quote yet                           |
| Volume    | `Σ tradeQty` (book quantities are not volume)  | never (starts at 0)                    |
| VWAP      | `Σ(price × qty) / Σ qty`                       | volume is 0                            |
| Imbalance | `(bidQty − askQty) / (bidQty + askQty)`, −1…+1 | no quote yet, or `bidQty + askQty = 0` |

Prices stay integer cents end to end and are rounded only for display
(`shared/format/market-format.ts`). Throughput is shown twice: nominal,
`updatesPerBatch × 1000 / intervalMs` updates/s (spread across all instruments), and measured over
a sliding 1 s window.

## Prerequisites

- **Node 24** and npm 11 (`.nvmrc`)
- **Rust via [rustup](https://rustup.rs/)**. The toolchain (1.99.0, with the `wasm32-unknown-unknown`
  target, clippy, rustfmt and llvm-tools) is pinned in `rust-toolchain.toml` and installed
  automatically on first use.
- For `npm run verify` only: `cargo +1.99.0 install cargo-llvm-cov --version 0.9.1 --locked`
  (Rust coverage)
- For the E2E suite (`npm run e2e`, `npm run verify`): `npx playwright install chromium`

## Commands

```bash
npm ci                      # install exact, pinned dependencies
npm run wasm:build          # compile the Rust producer → public/wasm/producer.wasm (needed by npm start)
npm start                   # dev server at http://localhost:4200
npm run build               # production build → dist/findev/browser
npm run build:pages         # same, shaped like the Pages deploy: base /findev/, a page per route, 404.html

npm run test:unit           # Angular unit + integration tests (Vitest, once)
npm run test:rust           # rustfmt --check, clippy (pedantic, -D warnings), cargo test
npm run test:wasm           # Node test suite on the real compiled producer.wasm (run wasm:build first)
npm run e2e                 # Playwright (Chromium) on the Pages build served under /findev/
npm run e2e:update-snapshots  # re-render visual baselines in the pinned Playwright image (Docker)
npm run verify              # every gate: static checks, gate self-test, Rust, Wasm, unit tests, build, E2E
```

## Quality gates

Every threshold is a hard failure, and deploy is blocked unless all gates are green.

| Where                 | What runs                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Commit                | Prettier + ESLint on staged files (lint-staged), conventional commit messages (commitlint)                                          |
| Push                  | `npm run verify:fast`: static checks, Rust, Wasm suite, unit tests with coverage thresholds                                         |
| CI, every push and PR | `static` ∥ `self-test` ∥ `test` (Rust tests, mutants, coverage; Wasm build, ABI check, Wasm tests; unit tests; Pages build) → `e2e` |
| CI, `main` only       | `deploy` (needs all four) → `smoke` against the live URL, including the deployed commit SHA → `smoke-e2e` (Playwright `@smoke`)     |

- **`npm run static`:** format check, ESLint with 0 warnings (architecture boundaries, complexity,
  size limits and the AAA test layout are lint rules), strict TypeScript, duplication ≤ 3 % (jscpd),
  dead code (knip), `npm audit`, and dependency age (every pin published ≥ 14 days ago).
- **Coverage:** ≥ 65 % global, ≥ 85 % for `core/producer`, `shared/format` and the Rust crate.
- **`npm run quality:self-test`:** proves each gate still fires by feeding it a deliberately bad
  input (lint, coverage, duplication, Rust, Wasm ABI, dependency age, git hooks, deploy smoke).
- **`npm run test:rust:mutants`:** injected Rust bugs must each make a test fail.
- **`npm run test:mutation`:** Stryker mutates `metrics.ts`, `producer-settings.ts` and
  `market-format.ts` and fails below an 80 % mutation score (currently 100 %; report in
  `reports/mutation/`). Equivalent mutants are marked in the source with a stated reason.
- **`npm run test:pyramid`:** counts tests per layer (after `test:ci`) and fails on an
  "ice-cream cone": unit ≥ 60 %, E2E ≤ 10 %, at least 3 integration tests.
- **Pull requests:** the `pr-size` job fails above 600 changed lines (excluding
  `package-lock.json`, `e2e/__screenshots__/` and `.claude/skills/`), and
  `.github/pull_request_template.md` asks for what/why, test evidence and the gate checklist.
- **`npm run e2e`:** Playwright on the deploy-shaped bundle (real worker and Wasm): live rows,
  pause/resume, settings validation and apply, navigation, the Wasm-404 banner with Retry, and axe
  (no serious or critical WCAG 2 A/AA violations). In CI it runs in the pinned Playwright image
  on the exact bundle that deploys.
- **Visual snapshots (`@visual`):** Settings and the paused Dashboard, with live values masked,
  compared pixel for pixel (≤ 100 differing pixels; a heading colour change alters ~480). Baselines in
  `e2e/__screenshots__` are rendered only in the pinned Linux Playwright image, so these specs run
  in CI and `npm run e2e:docker`, and are skipped by a local `npm run e2e` on macOS or Windows. After
  an intended UI change: `npm run build:pages && npm run e2e:update-snapshots`, then review and
  commit the PNGs.

## Requirements coverage

Every requirement (R1–R24, see `docs/IMPLEMENTATION_PLAN.md`) has passing automated tests, or a
recorded manual check where only a browser can show it.

| ID  | Requirement                                                                  | Covered by                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Dashboard and Settings pages, with navigation                                | `app.routes.spec.ts`, `app.spec.ts`, E2E `navigation`, `settings`                                                                                                           |
| R2  | One row per instrument, 5 metrics                                            | `metrics.spec.ts`, `metrics-table.spec.ts`, E2E `dashboard`                                                                                                                 |
| R3  | Cumulative volume/VWAP, each trade once, book qty excluded                   | `metrics.spec.ts`, `producer-store.integration.spec.ts`                                                                                                                     |
| R4  | Unavailable values and volume 0 before data; zero denominator ⇒ unavailable  | `metrics.spec.ts`, `market-format.spec.ts`, `metrics-table.spec.ts`                                                                                                         |
| R5  | Currency prices; imbalance in [−1, +1]                                       | `market-format.spec.ts`, `market-format-pipes.spec.ts`, E2E `dashboard`                                                                                                     |
| R6  | Pause/Resume, totals kept, no catch-up                                       | `producer-engine.spec.ts`, `producer-store.spec.ts`, E2E `pause-resume`; manual: 30 s CDP freeze (no burst)                                                                 |
| R7  | Producer status                                                              | `producer-status.spec.ts`, `pill.spec.ts`, `app.spec.ts`                                                                                                                    |
| R8  | Settings form: 3 integer fields, defaults and ranges                         | `producer-settings.spec.ts`, `settings-schema.spec.ts`, `settings.spec.ts`, E2E `settings`                                                                                  |
| R9  | Editing doesn't apply; Apply starts a new run, clears totals, also if paused | `settings.spec.ts`, `producer-store.spec.ts`, E2E `settings`                                                                                                                |
| R10 | Starts with defaults, running                                                | `producer-store.spec.ts`, E2E `dashboard`                                                                                                                                   |
| R11 | Navigation keeps the run and its state; one producer only                    | `producer-store.integration.spec.ts`, `app.integration.spec.ts` (worker factory count), E2E `navigation`                                                                    |
| R12 | Old-run results never overwrite the new run                                  | `producer-store.spec.ts`, `producer-engine.spec.ts`, `producer-engine-ordering.spec.ts`                                                                                     |
| R13 | Wasm generates trades + quotes; randomness and price logic in Wasm           | Rust `model::`, `rng::` tests; lint ban on `Math.random`; `wasm:verify` (exports, no imports)                                                                               |
| R14 | Per-instrument state, exact batch sizes, prices evolve                       | Rust `producer::` tests, `wasm-tests/producer.wasm.test.ts`                                                                                                                 |
| R15 | Invariants: price > 0, bid < ask, qty > 0, trade at bid or ask               | Rust `model::tests::every_update_satisfies_the_market_invariants`, `producer.wasm.test.ts` (50 000 updates)                                                                 |
| R16 | Wasm runs in a Web Worker                                                    | `producer-tokens.spec.ts`, lint rule (only `WORKER_FACTORY` may call `new Worker`), all E2E specs                                                                           |
| R17 | Integer cents; rounding only for display                                     | `metrics.spec.ts`, `market-format.spec.ts`                                                                                                                                  |
| R18 | No event history; every trade counted                                        | `metrics.spec.ts`; manual: 5 min at max load, JS heap +0.25 MB after GC                                                                                                     |
| R19 | Usable at 20 000 updates/s                                                   | Manual (Chrome trace, 50/1000/50): 0 long tasks, measured rate within ±10 %, batch work p99 0.09 ms; slow devices: `repaint-pacer.spec.ts`, `producer-store-pacing.spec.ts` |
| R20 | Clear init errors; resources cleaned up                                      | `producer-engine.spec.ts`, `producer-store-lifecycle.spec.ts`, `wasm-generator.spec.ts`, E2E `init-error`                                                                   |
| R21 | Unit tests for metrics, settings, pause/resume, stale runs, generator        | The suites above; `npm run test:pyramid` (unit ≥ 60 %)                                                                                                                      |
| R22 | Fixed inputs, controllable time, no long waits                               | `ManualScheduler`, seeded RNG, fake worker; the AAA lint rule                                                                                                               |
| R23 | Public repo, README, incremental history                                     | This README; one conventional commit per plan step                                                                                                                          |
| R24 | Every push builds; `main` redeploys; live demo                               | `.github/workflows/ci-deploy.yml`, `scripts/smoke-deploy.mjs`, E2E `@smoke` on the live URL                                                                                 |

## Known limits

- **Number precision (D5):** `Σ price × qty` is a float64 that stays an exact integer below 2^53.
  At the maximum load on a single instrument that holds for about 12.5 hours; after that the
  relative error is about 1e-16, invisible once rounded to cents. BigInt was rejected as 10–50×
  slower in the hot loop.
- **Measured throughput** is a little under nominal at the fastest settings (about 18–19k/s vs
  20k/s at 50 ms), because timer lateness is not compensated; there is deliberately no catch-up.
- **Slow devices:** after 3 repaints slower than 50 ms within a second, the table repaints at
  most 10 times a second, always with the latest totals, and its caption says so. Every batch
  is still processed. Measured at maximum load, 20× CPU slowdown, with the accessibility tree
  on: 56.5 fps and 0.2 long tasks a second over 40 s, against 34.5 fps and 4.8 a second when
  every batch is repainted.
- **Background tabs:** browsers throttle timers in hidden tabs, so throughput drops while hidden.
  When the tab returns, generation simply continues; there is no burst of catch-up batches.
- **Deploy only from `main`:** other branches and PRs run every gate but never deploy.
