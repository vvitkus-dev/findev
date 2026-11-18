# Realtime Fintech Dashboard — Implementation Plan

> Status: ready for implementation · Baseline: Angular 22.2 (zoneless, standalone), TypeScript 6.0, Vitest 5 via `@angular/build:unit-test`, Node 24 (`.nvmrc`).
> Repo state at planning time: fresh `ng new` scaffold, single commit `ec77f8e`, no Rust toolchain installed locally.

---

## 0. Requirement analysis

### 0.1 Requirements decomposed into testable statements

| ID  | Requirement (normalised)                                                                                               | Source | Verified by                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| R1  | Two pages: Dashboard, Settings; navigation between them                                                                | §1, §2 | component tests + manual                                                   |
| R2  | One table row per instrument; 5 metrics: last price, spread, volume, VWAP, imbalance                                   | §1     | `metrics.spec.ts`, `metrics-table.spec.ts`                                 |
| R3  | Volume & VWAP cumulative since run start; every trade counted exactly once; book quantities never contribute to volume | §1, §3 | `metrics.spec.ts`                                                          |
| R4  | Before data: unavailable values + volume 0. Zero denominator ⇒ unavailable                                             | §1     | `metrics.spec.ts`, `market-format.spec.ts`                                 |
| R5  | Prices formatted as currency; imbalance in [−1, +1]                                                                    | §1     | `market-format.spec.ts`                                                    |
| R6  | Pause/Resume; pausing stops generation; resume keeps totals; no data for paused interval (no catch-up)                 | §1     | `producer-engine.spec.ts`, `producer-store.spec.ts`                        |
| R7  | Basic producer status                                                                                                  | §1     | `producer-status.spec.ts`                                                  |
| R8  | Settings form: 3 integer fields, defaults 5/100/500, ranges 1–50 / 1–1000 / 50–2000                                    | §2     | `producer-settings.spec.ts`, `settings-schema.spec.ts`, `settings.spec.ts` |
| R9  | Editing does not affect producer; **Apply** starts a new run, clears values/totals, starts even if paused              | §2     | `settings.spec.ts`, `producer-store.spec.ts`                               |
| R10 | App starts with defaults (running)                                                                                     | §2     | `producer-store.spec.ts`                                                   |
| R11 | Navigation preserves run + running/paused; never creates extra producers                                               | §2     | `producer-store.spec.ts` (worker factory call count)                       |
| R12 | Results from previous run never overwrite new run state                                                                | §2     | `producer-store.spec.ts`, `producer-engine.spec.ts`                        |
| R13 | Wasm generates **market updates** (trade + bid/ask snapshot); randomness & price logic in Wasm                         | §3     | Rust tests + `grep` control check (no `Math.random` in producer path)      |
| R14 | Generator keeps per-instrument state; returns batches of requested size; prices evolve from previous values            | §3     | Rust tests, `wasm-abi.test.ts`                                             |
| R15 | Invariants: price > 0, bid < ask, tradeQty > 0, book qty ≥ 0, trade price ∈ {bid, ask}                                 | §3     | Rust property-style tests + `wasm-abi.test.ts`                             |
| R16 | Wasm runs inside a Web Worker                                                                                          | §3     | build artefact check + code review gate                                    |
| R17 | Integer cents everywhere; rounding only at display                                                                     | §3     | `metrics.spec.ts`, review gate                                             |
| R18 | No full event history retained; UI may refresh slower than production but all trades counted                           | §3     | `metrics.spec.ts` (O(instruments) state), review gate                      |
| R19 | UI stays usable at high rates (max = 1000 updates / 50 ms = 20 000 updates/s)                                          | §3     | Phase 9 performance check                                                  |
| R20 | Meaningful init errors; producer resources cleaned up on replace/destroy                                               | §3     | `producer-engine.spec.ts`, `producer-store.spec.ts`                        |
| R21 | Unit tests: metrics, settings+reset, pause/resume+stale rejection, generator                                           | §4     | test suites listed above                                                   |
| R22 | Tests use fixed inputs / controllable deps; no long real-time waits                                                    | §4     | injected scheduler + seeded RNG; CI test duration gate                     |
| R23 | Public GitHub repo, README (build/run/test), incremental commit history                                                | §5     | Phase 8 checks                                                             |
| R24 | Every push auto-builds and redeploys; live demo link                                                                   | §5     | Phase 8 checks                                                             |

### 0.2 Derived / implicit requirements (things the spec implies but does not spell out)

- **D1 — Run identity.** "Results from a previous run must not overwrite the new run's state" ⇒ every message carries a monotonically increasing `runId`; both worker and main thread discard mismatched messages.
- **D2 — Deterministic generator.** Tests need fixed inputs ⇒ generator takes an explicit 64-bit seed. Production seeds come from `crypto.getRandomValues` (entropy source only; all random _draws_ happen in Wasm).
- **D3 — Controllable time.** "No long real-time waits" ⇒ the worker-side engine never calls `setTimeout` directly; it uses an injected `Scheduler` + `Clock`.
- **D4 — Base-href-safe Wasm URL.** GitHub Pages serves under `/<repo>/` ⇒ the Wasm URL is resolved from `document.baseURI` on the main thread and passed to the worker.
- **D5 — Number precision.** `Σ(price×qty)` in cents stays an exact integer in `float64` while `< 2^53 ≈ 9.0e15`. Worst case per instrument (1 instrument, 20 000 updates/s, price ≈ 1e5 cents, qty ≤ 100) ≈ 2e11 cents/s ⇒ exact for ~12.5 h; beyond that relative error ≈ 1e-16, invisible after rounding to cents. Decision: plain `number`, documented, with a unit test at the boundary. (BigInt rejected: 10–50× slower in the hot loop, no visible benefit.)
- **D6 — Status model.** `initializing → running ⇄ paused`, any → `error`. Shown on dashboard with run number and measured throughput.
- **D7 — Scheduling semantics.** "Requested time between batches" ⇒ start-to-start interval; if a batch takes longer than the interval, the next one starts immediately but never _bursts_ to catch up.

### 0.3 Ambiguities and the decision taken

| Ambiguity                                                         | Decision                                                                                           | Rationale                                                                                                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is a batch generated _before_ pause but delivered after it valid? | **Accept** it (same `runId`).                                                                      | Those trades were generated in the current run; dropping them would violate "every generated trade must contribute". Pause stops _generation_, not delivery of what was already generated. |
| Should Apply navigate to dashboard?                               | Stay on Settings, show "Run #N started" confirmation.                                              | Least surprise; user may tweak further. Interviewer can change in 1 line.                                                                                                                  |
| Settings form when re-visited                                     | Shows the **active (applied)** settings; unsaved drafts are discarded on navigation.               | Form must reflect producer truth; persisting drafts is not required.                                                                                                                       |
| Symbols for 50 instruments                                        | Fixed, deterministic list of 50 four-letter tickers (`ALFA, BETA, GAMA, DLTA, …`) mapped by index. | Wasm only emits `u32` instrument index; no strings cross the boundary.                                                                                                                     |
| "Each push must redeploy"                                         | Deploy on every push to `main`; other branches run build+test only.                                | Interview changes go to `main`; avoids racing deployments from branches to one Pages site. Documented in README.                                                                           |

---

## 1. Architecture decisions & trade-offs

### 1.1 Wasm language / toolchain

| Option                                     | Pros                                                                                                                                                              | Cons                                                                                                                   | Verdict                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Rust** (`wasm32-unknown-unknown`, cargo) | Industry standard for Wasm; zero-runtime output (~10–25 KB); `cargo test` gives native, fast generator tests; strong types; rustup preinstalled on GitHub runners | Extra local toolchain (rustup); learning curve for reviewers                                                           | **Chosen**                                                    |
| AssemblyScript                             | npm-only toolchain, TS-like syntax familiar to Angular devs                                                                                                       | Weaker credibility as "real Wasm" ("TS wrapped in Wasm" perception); thinner test ecosystem; less common in production | Rejected — risk of failing "not a trivial wrapper" perception |
| C/C++ + Emscripten                         | Mature                                                                                                                                                            | Heavy SDK (~1 GB), generated JS glue, slower CI                                                                        | Rejected                                                      |
| Zig / TinyGo                               | Small outputs                                                                                                                                                     | Niche, less explainable, smaller ecosystem                                                                             | Rejected                                                      |

### 1.2 JS ↔ Wasm interface

| Option                                                                                                               | Pros                                                                                                                                               | Cons                                                                                                                  | Verdict    |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------- |
| `wasm-bindgen` + `wasm-pack`                                                                                         | Ergonomic, generates TS types                                                                                                                      | Generated JS glue must be bundled into the worker; extra tool; returning arrays copies; harder to explain bytes-level | Rejected   |
| **Raw C ABI** (`#[unsafe(no_mangle)] extern "C"`), records written into linear memory, JS reads a `Uint32Array` view | Zero copies, zero glue, ~6 exported functions, fully explainable, loads with plain `WebAssembly.instantiate` in both browser worker and Node tests | Manual pointer handling; must re-create views if memory grows                                                         | **Chosen** |

Rules for the raw ABI (enforced by tests):

1. Every exported function is listed in `ABI_EXPORTS` and verified by `scripts/verify-wasm.mjs`.
2. JS creates the `Uint32Array` view **after** every `generate` call (memory may grow → old `ArrayBuffer` detached).
3. `abi_version()` export guards against stale artefacts.

### 1.3 Batch transport format inside the worker

| Option                                                | Pros                                      | Cons                              | Verdict                                      |
| ----------------------------------------------------- | ----------------------------------------- | --------------------------------- | -------------------------------------------- |
| JSON / JS objects per update                          | Readable                                  | 20 000 allocations/s, GC pressure | Rejected                                     |
| Struct-of-arrays (7 pointers)                         | Vectorisable                              | 7 views to manage                 | Rejected (complexity, no gain at this scale) |
| **Array-of-structs, 7 × `u32` per update (28 bytes)** | One pointer, one view, trivially iterable | —                                 | **Chosen**                                   |

Record layout (`#[repr(C)]`, little-endian `u32`): `[instrument, priceCents, tradeQty, bidCents, askCents, bidQty, askQty]`.

### 1.4 Where metrics are calculated

| Option                                                                            | Pros                                                                                                                                                 | Cons                                                                                                            | Verdict    |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------- |
| In Wasm                                                                           | Fastest                                                                                                                                              | Metric tests (worked example) would live in Rust; duplicating snapshot export ABI; harder for Angular reviewers | Rejected   |
| On main thread from raw batches                                                   | Simple worker                                                                                                                                        | Up to 28 KB × 20/s transferred and folded on UI thread; stale-run batches must be rolled back                   | Rejected   |
| **In the worker (TS accumulator), main thread receives O(instruments) snapshots** | Main thread only renders; transfer ≤ 50 small records per batch; accumulator is a pure TS module → easy Vitest tests; stale snapshots simply dropped | Accumulated state lives in worker (main has a copy via snapshots)                                               | **Chosen** |

Split: **accumulation** (`applyBatch` → raw sums) in worker; **derivation** (`deriveMetrics` → spread, VWAP, imbalance, nulls) is a pure function used by the main thread. Both in `metrics.ts`, both unit-tested.

### 1.5 Worker lifecycle across runs

| Option                                                                                                                  | Pros                                                                                         | Cons                                                                                                     | Verdict    |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------- |
| New worker per Apply                                                                                                    | Strongest isolation                                                                          | Re-fetch/compile Wasm each Apply; more lifecycle code paths; still needs `runId` because tests demand it | Rejected   |
| **One long-lived worker per app, one Wasm generator instance per run** (`producer_destroy` old → `producer_create` new) | Navigation can never create producers; cleanup per run is explicit and testable; cheap Apply | Must guard with `runId` (required anyway)                                                                | **Chosen** |

Worker is recreated only by the explicit "Retry" action after a fatal init error. Worker is terminated when the root injector is destroyed.

### 1.6 Scheduling

| Option                                                                                                        | Verdict                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `setInterval`                                                                                                 | Rejected — overlapping ticks / bursts after throttling.                        |
| Main-thread timer sending "generate" commands                                                                 | Rejected — couples generation to UI-thread jank.                               |
| **Worker-side self-rescheduling `setTimeout` via injected `Scheduler`**, delay = `max(0, interval − elapsed)` | **Chosen** — no overlap, no catch-up bursts, testable with a manual scheduler. |

### 1.7 State management & change detection

| Option                                                                                                                  | Verdict                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NgRx Store                                                                                                              | Rejected — heavy for one feature; more to explain than to gain.                                                                                                                                                                                 |
| RxJS `BehaviorSubject` service                                                                                          | Viable, but more boilerplate in zoneless templates.                                                                                                                                                                                             |
| **`@Service()` singleton `ProducerStore` with Angular signals (private `signal`, public `.asReadonly()` / `computed`)** | **Chosen** — idiomatic Angular 22 (`@Service` is the v22 recommended singleton decorator, tree-shakable, no `providers` entry), zoneless-friendly, worker messages update signals → OnPush (v22 default) views re-render only bound text nodes. |

UI refresh rate: worker posts ≤ 1 snapshot per batch ⇒ ≤ 20 Hz worst case. Main thread stores only the _latest_ snapshot (no queue). Optional coalescing via `requestAnimationFrame` documented as a lever but not needed at 20 Hz × 50 rows.

### 1.8 Forms

| Option                                                                                                        | Verdict                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template-driven                                                                                               | Rejected — validation harder to unit-test.                                                                                                                                            |
| Typed Reactive Forms (`NonNullableFormBuilder`)                                                               | Rejected — the `angular-developer` skill says new forms on v22+ should use Signal Forms; Reactive Forms is only for existing forms.                                                   |
| **Signal Forms (`@angular/forms/signals`: `form()`, `[formField]`, `required/min/max/validate`, `submit()`)** | **Chosen** — stable in v22, model is a plain `signal<ProducerSettings>` (fits the signals store), validation lives in one schema function, state is signals → trivial zoneless tests. |

Signal Forms rules that apply here (from `.claude/skills/angular-developer/references/signal-forms.md`):

- The form model is a **local draft** `signal({...store.settings()})`. It is a copy, so editing never touches the store (R9). The model must not contain `null`; numbers start at their current value.
- Put validation in the schema: `required`, `min`, `max` from `SETTINGS_LIMITS` with messages, and `validate()` returning `{kind:'integer', message}` for non-integers or `NaN` (an empty number input). A validator returns `undefined` when the value is valid, never `null`.
- **Forbidden on `[formField]` inputs:** `min`/`max` attributes, `[value]`, `[disabled]`. The schema handles them. `step="1"` and `inputmode="numeric"` are allowed.
- Apply goes through `submit(form, async () => store.apply(model()))`. `submit` marks all fields touched and runs the callback only when the form is valid. The Apply button uses `[disabled]="settingsForm().invalid()"`.
- Read field state by calling the field: `settingsForm.instrumentCount().errors()`. `settingsForm.instrumentCount.errors()` is wrong.

### 1.9 Hosting / CD

| Option                              | Pros                                                                                                                    | Cons                                                                                        | Verdict     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------- |
| **GitHub Pages via GitHub Actions** | Same platform as repo; no third-party account linking; Rust + Node on same runner; serves `.wasm` as `application/wasm` | Sub-path (`/<repo>/`) needs `--base-href`; no SPA fallback ⇒ copy `index.html` → `404.html` | **Chosen**  |
| Cloudflare Pages                    | SPA fallback, previews                                                                                                  | Its build image needs Rust installed manually; external account                             | Alternative |
| Vercel                              | Previews                                                                                                                | Same Rust issue; external account                                                           | Alternative |

---

## 2. Target structure

```
.
├── rust-toolchain.toml                 # pins Rust channel + wasm32 target (deterministic CI)
├── wasm/producer/
│   ├── Cargo.toml                      # cdylib, opt-level="s", lto, panic="abort", strip
│   └── src/
│       ├── lib.rs                      # extern "C" ABI only
│       ├── rng.rs                      # SplitMix64 seeding + xoshiro128** / PCG32
│       ├── model.rs                    # InstrumentState, price walk, book, trade
│       └── producer.rs                 # Producer { rng, instruments, buffer }
├── scripts/
│   ├── build-wasm.mjs                  # cargo build → public/wasm/producer.wasm → verify
│   ├── verify-wasm.mjs                 # asserts export names, abi_version, size budget
│   └── smoke-deploy.mjs                # curls live URL + wasm content-type
├── wasm-tests/
│   ├── vitest.config.ts                # environment: node
│   └── producer.wasm.test.ts           # runs the compiled module through wasm-generator.ts
├── public/wasm/                        # build output (git-ignored)
├── tsconfig.worker.json
├── src/app/
│   ├── app.ts / app.html / app.routes.ts / app.config.ts
│   ├── core/producer/
│   │   ├── engine/                     # FRAMEWORK-FREE (lint-enforced, Q0.4): runs in the worker / Node tests
│   │   │   ├── protocol.model.ts       # message types (main ⇄ worker) — models keep `.model.ts`
│   │   │   ├── producer-settings.model.ts  # interface ProducerSettings
│   │   │   ├── producer-settings.ts    # DEFAULT_SETTINGS, SETTINGS_LIMITS, validateSettings()
│   │   │   ├── symbols.ts              # 50 deterministic tickers
│   │   │   ├── metrics.ts              # accumulator + applyBatch + deriveMetrics
│   │   │   ├── scheduler.ts            # Scheduler/Clock interfaces + real impls
│   │   │   ├── wasm-generator.ts       # WebAssembly adapter
│   │   │   ├── producer-engine.ts      # worker-side state machine
│   │   │   └── producer.worker.ts      # thin adapter: self.onmessage → engine
│   │   ├── producer-tokens.ts          # WORKER_FACTORY, SEED_SOURCE, WASM_URL InjectionTokens
│   │   └── producer-store.ts           # @Service() ProducerStore — signals, runId gate
│   ├── shared/format/
│   │   ├── market-format.ts            # pure fns: formatCents, formatImbalance, formatVolume ("—" for null)
│   │   └── market-format-pipes.ts      # pure pipes delegating to the fns (cents | imbalance | volume)
│   └── features/
│       ├── dashboard/  dashboard.ts (class Dashboard), components/metrics-table.ts, components/producer-status.ts
│       └── settings/   settings.ts (class Settings, Signal Form), settings-schema.ts (validation schema)
├── .github/workflows/ci-deploy.yml
└── README.md
```

---

## 3. Key contracts (write these first; everything else depends on them)

### 3.1 Wasm ABI (`wasm/producer/src/lib.rs`)

```rust
// Rust 2024 edition: exported symbols need `#[unsafe(no_mangle)]` (verified with toolchain 1.99.0).
pub const ABI_VERSION: u32 = 1;
pub const RECORD_WORDS: u32 = 7;          // u32 words per update record
pub const MAX_INSTRUMENTS: u32 = 50;
pub const MAX_BATCH: u32 = 1000;

#[unsafe(no_mangle)] pub extern "C" fn abi_version() -> u32;
#[unsafe(no_mangle)] pub extern "C" fn record_words() -> u32;
/// Returns 0 (null) when instrument_count ∉ [1, MAX_INSTRUMENTS].
#[unsafe(no_mangle)] pub extern "C" fn producer_create(instrument_count: u32, seed_lo: u32, seed_hi: u32) -> *mut Producer;
/// Writes exactly `n` records into the producer-owned buffer; returns pointer to first record.
/// Returns 0 when producer is null or n ∉ [1, MAX_BATCH].
#[unsafe(no_mangle)] pub extern "C" fn producer_generate(p: *mut Producer, n: u32) -> *const u32;
#[unsafe(no_mangle)] pub extern "C" fn producer_destroy(p: *mut Producer);
```

`memory` is exported by default.

### 3.2 Generator model (all in Rust)

Per instrument state: `mid_cents: i64`, `spread_cents: u32`, `bid_qty: u32`, `ask_qty: u32`.

Per update:

1. `i = rng.below(instrument_count)` — instrument may repeat within a batch.
2. **Mid walk**: `delta = round(mid × u × 5 / 10_000)` with `u ∈ [−1, 1]`, at least ±1 cent with prob ½ (keeps low prices moving). `mid = max(MIN_MID=100, mid + delta)` (reflecting floor ⇒ price > 0 always).
3. **Spread**: random walk in `[1, max(1, mid/500)]` cents ⇒ `bid = mid − spread/2`, `ask = bid + spread`, then `bid = max(1, bid)`, `ask = max(ask, bid + 1)` ⇒ `0 < bid < ask`.
4. **Book**: `bid_qty`, `ask_qty` random walk with step ±50, clamped to `[0, 1000]` ⇒ ≥ 0, sum may be 0 (exercises zero-denominator path).
5. **Trade side**: buy-at-ask with probability `0.5 + 0.25 × imbalance` (imbalance from the book), otherwise sell-at-bid ⇒ `price ∈ {bid, ask}`.
6. **Trade qty**: `1 + rng.below(100)` ⇒ ≥ 1.
7. Initial mids: `rng` in `[1_000, 50_000]` cents per instrument at `producer_create`.

RNG: SplitMix64 to expand the 64-bit seed, PCG32 for draws. No external crates (avoids `getrandom` Wasm issues; smaller binary; fully explainable).

### 3.3 TypeScript generator adapter (`wasm-generator.ts`)

```ts
export interface MarketGenerator {
  /** Returns a view of n×7 u32 words. Valid only until the next generate/dispose call. */
  generate(n: number): Uint32Array;
  dispose(): void; // idempotent
}
export interface GeneratorFactory {
  create(instrumentCount: number, seed: readonly [number, number]): MarketGenerator;
}
export async function loadWasmGeneratorFactory(
  source: URL | ArrayBuffer,
): Promise<GeneratorFactory>;
// - verifies abi_version() === 1 and record_words() === 7, else throws WasmAbiError
// - instantiateStreaming when URL + correct MIME, falls back to arrayBuffer() + instantiate
```

### 3.4 Worker protocol (`protocol.model.ts`)

```ts
export interface ProducerSettings {
  instrumentCount: number;
  updatesPerBatch: number;
  batchIntervalMs: number;
}

export type ToWorker =
  | { type: 'init'; wasmUrl: string }
  | { type: 'start'; runId: number; settings: ProducerSettings; seed: [number, number] }
  | { type: 'pause'; runId: number }
  | { type: 'resume'; runId: number }
  | { type: 'dispose' };

export interface InstrumentAccumulatorDto {
  symbol: string;
  lastPriceCents: number | null;
  bidCents: number | null;
  askCents: number | null;
  bidQty: number | null;
  askQty: number | null;
  volume: number; // Σ qty
  notionalCents: number; // Σ price×qty
  trades: number;
}

export type FromWorker =
  | { type: 'ready' }
  | {
      type: 'snapshot';
      runId: number;
      seq: number;
      instruments: InstrumentAccumulatorDto[];
      stats: { batches: number; updates: number; lastBatchMs: number };
    }
  | { type: 'status'; runId: number; status: 'running' | 'paused' }
  | { type: 'error'; runId: number | null; phase: 'init' | 'runtime'; message: string };
```

### 3.5 Metrics (`metrics.ts`)

```ts
export function createAccumulators(instrumentCount: number): InstrumentAccumulatorDto[]; // nulls, zeros
export function applyBatch(acc: InstrumentAccumulatorDto[], words: Uint32Array, n: number): void; // O(n), no allocation
export interface InstrumentMetrics {
  symbol: string;
  lastPriceCents: number | null;
  spreadCents: number | null; // ask − bid
  volume: number;
  vwapCents: number | null; // notional / volume, unrounded
  imbalance: number | null; // (bq − aq)/(bq + aq)
}
export function deriveMetrics(a: InstrumentAccumulatorDto): InstrumentMetrics;
```

### 3.6 Main-thread store (`producer-store.ts`)

```ts
@Service() // v22 singleton decorator, replaces @Injectable({providedIn:'root'})
export class ProducerStore {
  // each public signal = private writable signal exposed via .asReadonly() or computed()
  readonly status: Signal<'initializing' | 'running' | 'paused' | 'error'>;
  readonly settings: Signal<ProducerSettings>;
  readonly runId: Signal<number>;
  readonly rows: Signal<InstrumentMetrics[]>; // computed from latest snapshot
  readonly stats: Signal<{ updatesPerSec: number; batches: number; updates: number }>;
  readonly error: Signal<string | null>;
  pause(): void;
  resume(): void;
  apply(settings: ProducerSettings): void; // validates, ++runId, resets rows, sends start
  retry(): void; // only from 'error': recreate worker
}
```

Dependencies injected: `WORKER_FACTORY` (`() => Worker`), `SEED_SOURCE` (`() => [number, number]`), `WASM_URL` (string). Tests replace all three.

---

## 4. Phased implementation

Conventions for every step:

- **Commit per step** (conventional commits, e.g. `feat(wasm): pcg32 rng`), so the history tells the story.
- A step is **done only when all its control checks pass**; checks are commands with an exact expected result (exit code, test name, grep result). No "looks fine".
- **Phase gate** = all step checks + the phase gate command listed at the end of the phase.
- **Angular code is written using the `angular-developer` skill** (`.claude/skills/angular-developer/`, see §4.0). Before any Angular step, load the skill and read the reference files that step names. Each Angular step also has an implicit check: `npx ng build` exits 0 afterwards. The skill requires this after every code generation.
- **Quality gates** (static analysis, complexity, duplication, coverage 65/85, testing pyramid, AAA, E2E, visual) are specified in `docs/QUALITY_GATES_PLAN.md`. Combined execution order:
  `Phase 0 → Q0 → Q1 → Phase 1 → Phase 2 (+Q2.1–Q2.3) → Phases 3–6 (+Q2.4 integration tests) → Phase 7 → Q3 → Phase 8 (+Q4) → Phase 9 → Q5 (stretch)`.
  Where the two plans overlap, the quality plan wins. It replaces step 0.3 (TS flags) with Q0.1, step 0.6 (format) with Q0.11, and the step 8.2 CI layout with Q4.2. The §4.0 grep guards become ESLint rules (Q0.4) and stay as a backup check in CI.
- Global gate command (defined in Phase 0, grows over time):
  ```bash
  npm run verify   # = lint:types && test:wasm && test && build
  ```

---

### 4.0 Angular coding standard: `angular-developer` skill

Source: https://angular.dev/ai/agent-skills, installed with
`npx skills add https://github.com/angular/skills --skill angular-developer --agent claude-code --copy -y`.
It is copied into `.claude/skills/angular-developer/`. The version is pinned by commit and hash in `skills-lock.json`. Restore with `npx skills experimental_install`, update with `npx skills update angular-developer -p`.

Rules taken from the skill. They apply to every Angular step and override the plan's older wording:

| Area          | Rule                                                                                                                                                                                                                                                                                 | Skill reference                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Version       | Check `package.json` first. Angular **22.2**: zoneless, standalone, OnPush is the default `changeDetection`, so don't set it.                                                                                                                                                        | SKILL.md §1                                                          |
| Scaffolding   | Use `ng generate component/service/pipe …`, then adjust the result.                                                                                                                                                                                                                  | `cli.md`                                                             |
| Naming        | "Intent over Role": `metrics-table.ts` → `class MetricsTable`. No `.component`/`.service` suffixes. Interfaces go in `*.model.ts`. Specs are named `<name>.spec.ts`. Don't mix the two styles.                                                                                       | `naming-conventions.md`                                              |
| Components    | Signal `input()`/`input.required()` and `output()`. Use built-in control flow (`@if/@for/@switch`, with `track` required on `@for`). Self-closing tags (`<router-outlet />`). Inline template for small components. No expensive work in templates: use `computed()` or a pure pipe. | `components.md`, `inputs.md`, `outputs.md`                           |
| Services / DI | `@Service()` for singletons. `inject()` instead of constructor parameters. `InjectionToken` with a `factory` as the default, replaced in tests with `{provide, useValue}`.                                                                                                           | `creating-services.md`, `defining-providers.md`                      |
| Reactivity    | `signal` / `computed` / `linkedSignal`. Avoid `effect` for state propagation; use it only for side effects.                                                                                                                                                                          | `signals-overview.md`, `effects.md`, `linked-signal.md`              |
| Forms         | **Signal Forms** for the settings form (see §1.8).                                                                                                                                                                                                                                   | `signal-forms.md`                                                    |
| Formatting    | Pure pipes in templates, delegating to plain exported functions. Never inject pipes into classes.                                                                                                                                                                                    | `pipes.md`                                                           |
| Routing       | `loadComponent` lazy routes; `RouterLink` and `routerLinkActive`.                                                                                                                                                                                                                    | `define-routes.md`, `loading-strategies.md`, `navigate-to-routes.md` |
| Styling       | Component styles stay encapsulated and inside the 4 kB budget. Native CSS only, no animation DSL.                                                                                                                                                                                    | `component-styling.md`, `angular-animations.md`                      |
| Testing       | Vitest with zoneless **Act → `await fixture.whenStable()` → Assert**. **Never use `fixture.detectChanges()`** or `markForCheck()`. Set inputs with `fixture.componentRef.setInput()`. Use `RouterTestingHarness` for navigation; don't mock the Router.                              | `testing-fundamentals.md`, `router-testing.md`                       |

Control checks for the standard. They run in the Phase 7 gate and before every push:

```bash
grep -rnE "detectChanges\(|markForCheck\(" src/app --include=*.spec.ts           # → empty
grep -rnE "@Injectable\(|providedIn: 'root'" src/app                             # → empty
grep -rnE "FormGroup|FormControl|FormBuilder|ReactiveFormsModule" src/app        # → empty
grep -rnE "\*ngIf|\*ngFor|\[ngSwitch\]" src/app                                  # → empty
grep -rnE "@Input\(|@Output\(|changeDetection:" src/app                          # → empty
find src/app -name "*.component.ts" -o -name "*.service.ts"                       # → empty
```

---

### Phase 0 — Toolchain & repo baseline

**Goal:** reproducible local + CI toolchain; scaffold cleaned; strict settings.

| Step | Work                                                                                                                                                                                       | Control check (deterministic)                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| 0.1  | ✅ Done: on `main`, `.nvmrc` committed, public repo `vvitkus-dev/findev` created and pushed.                                                                                               | `git branch --show-current` → `main`; `git ls-remote origin main` = local `HEAD`                                    |
| 0.1b | ✅ Done: `angular-developer` skill installed (see §4.0) and `skills-lock.json` committed.                                                                                                  | `test -f .claude/skills/angular-developer/SKILL.md && jq -e '.skills["angular-developer"]' skills-lock.json` exit 0 |
| 0.2  | Install rustup locally; add `rust-toolchain.toml` (`channel = "1.xx.0"` pinned stable, `targets = ["wasm32-unknown-unknown"]`, `profile = "minimal"`).                                     | `rustc --version` prints the pinned version; `rustup target list --installed` contains `wasm32-unknown-unknown`     |
| 0.3  | `tsconfig.json`: add `"strict": true`, `"noUncheckedIndexedAccess": true`; angular: `strictTemplates: true`.                                                                               | `npx tsc -p tsconfig.app.json --noEmit` exit 0                                                                      |
| 0.4  | Remove placeholder `app.html` content; minimal shell `<router-outlet />`; update `app.spec.ts` (Act → `whenStable` → Assert).                                                              | `npx ng test --watch=false` exit 0                                                                                  |
| 0.5  | npm scripts: `wasm:build`, `wasm:verify`, `test:wasm`, `test:rust`, `lint:types`, `verify`, `prestart`/`prebuild` → `wasm:build`. `.gitignore`: `/public/wasm/`, `/wasm/producer/target/`. | `npm run` lists all scripts; `git check-ignore public/wasm/x.wasm` exit 0                                           |
| 0.6  | Prettier check script `format:check`.                                                                                                                                                      | `npm run format:check` exit 0                                                                                       |

> **Status (2026-11-18): Phase 0 complete.**
>
> - 0.2: rustup is installed with no default toolchain. `rust-toolchain.toml` pins **1.99.0** (1.100.0 was only 6 days old) with `clippy`, `rustfmt`, `llvm-tools-preview` and `wasm32-unknown-unknown`. A smoke build of a throwaway crate gave a 320-byte module, and `add(2,40)` returned 42 in Node.
> - 0.3 and 0.6 were done as Q0.1 and Q0.11.
> - 0.4: the shell replaced the CLI placeholder, test first (red, then green).
> - 0.5: the quality scripts and the Wasm git-ignores exist. The `wasm:*` and `test:rust` scripts come with Phase 1, when there is something for them to run.

**Phase 0 gate:** `npx ng build` exit 0 and `npx ng test --watch=false` exit 0 on a clean clone (`git clean -xdf -e node_modules && npm ci`).

---

### Phase 1 — Wasm producer (Rust)

**Goal:** a deterministic, invariant-preserving market update generator exposed via the raw ABI.

| Step | Work                                                                                                                                                                                                                                                                               | Control check                                                                                                                                                                                                                                                                                                                                                |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1  | `cargo new --lib wasm/producer`; `crate-type = ["cdylib", "rlib"]` (rlib lets `cargo test` run natively); release profile `opt-level="s"`, `lto=true`, `codegen-units=1`, `panic="abort"`, `strip=true`.                                                                           | `cargo build --manifest-path wasm/producer/Cargo.toml --release --target wasm32-unknown-unknown` exit 0                                                                                                                                                                                                                                                      |
| 1.2  | `rng.rs`: SplitMix64 + PCG32, `next_u32`, `below(n)` (Lemire unbiased), `unit_f64`.                                                                                                                                                                                                | `cargo test rng::` — tests: (a) same seed ⇒ identical first 1 000 outputs, (b) different seeds differ, (c) `below(7)` over 70 000 draws: every bucket within ±10 % of 10 000 (fixed seed ⇒ deterministic)                                                                                                                                                    |
| 1.3  | `model.rs`: `InstrumentState::new(rng)`, `step(&mut self, rng) -> Update` implementing §3.2.                                                                                                                                                                                       | `cargo test model::` — 100 000 steps from fixed seed: `price>0`, `0<bid<ask`, `qty≥1`, `bidQty,askQty ≤ 1000`, `price==bid‖price==ask`; continuity: `                                                                                                                                                                                                        | mid_t − mid_{t−1} | ≤ max(1, mid×5/10000)+1` |
| 1.4  | `producer.rs`: `Producer { rng, instruments: Vec<InstrumentState>, buf: Vec<u32> }`, `generate(n)` writes `n×7` words, reuses buffer (`clear` + `reserve`).                                                                                                                        | `cargo test producer::` — (a) `generate(n).len() == n*7` for n ∈ {1, 2, 100, 1000}; (b) all instrument indices `< count`; (c) with count=3 over 3 000 updates every instrument appears; (d) determinism: two producers same seed ⇒ identical batches; (e) **state retention**: batch₂'s first update for instrument k is continuous with batch₁'s last for k |
| 1.5  | `lib.rs`: ABI functions; null/invalid handling (`count ∉ [1,50]` ⇒ 0; `n ∉ [1,1000]` ⇒ 0; null producer ⇒ 0; `destroy(null)` no-op).                                                                                                                                               | `cargo test abi::` — invalid inputs return null; create/destroy 10 000× without panic                                                                                                                                                                                                                                                                        |
| 1.6  | `scripts/build-wasm.mjs`: runs cargo, copies to `public/wasm/producer.wasm`. `scripts/verify-wasm.mjs`: `WebAssembly.Module.exports` equals exactly `{memory, abi_version, record_words, producer_create, producer_generate, producer_destroy}`; `abi_version()==1`; size ≤ 64 KB. | `npm run wasm:build && npm run wasm:verify` exit 0, prints `OK exports=6 size=<N>B`                                                                                                                                                                                                                                                                          |
| 1.7  | `cargo clippy -- -D warnings`, `cargo fmt --check` in `test:rust`.                                                                                                                                                                                                                 | `npm run test:rust` exit 0                                                                                                                                                                                                                                                                                                                                   |

> **1.1 status (2026-11-18): done.**
>
> - **Crate:** `wasm/producer` (`market-producer`, edition 2024, `cdylib` + `rlib`, release profile as specified, no dependencies).
> - **Starting point:** `lib.rs` holds only `ABI_VERSION`, the `abi_version()` export and its test.
> - **Control check:** `npm run wasm:compile` (replaced by `wasm:build` in 1.6) exits 0 and produces a 65-byte module whose exports are `memory` and `abi_version`, with `abi_version()` returning 1.
> - **Scripts:** `npm run test:rust` runs fmt-check, clippy on native and `wasm32`, and `cargo test`. `scripts/cargo.mjs` adds the manifest path and `~/.cargo/bin`, so the scripts also work from git hooks.

> **1.2 status (2026-11-18): done.**
>
> - **Implementation:** `rng.rs` uses `SplitMix64` seeding into PCG32 (XSH-RR), Lemire's unbiased `below`, and 53-bit `unit_f64` / `signed_unit_f64`. No crates.
> - **Tests (7):** the plan's three (determinism, different seeds, ±10 % buckets), **known-answer vectors** (SplitMix64 for seed 1234567; PCG32 `pcg32-demo` for (42, 54), cross-checked against an independent Python implementation), edge bounds (`below(0)`, `below(1)`, `below(u32::MAX)`), and the `[0,1)` / `[-1,1)` ranges.
> - **Mutation check:** `npm run test:rust:mutants` applies 7 realistic bugs to a temporary copy; each is killed by exactly the test meant for it. Compile-breaking mutants count as invalid, not killed.
> - **Truncating casts:** isolated in `low32` and marked `#[expect(..., reason)]`. One `expect` turned out to be unfulfilled, so it was removed; `expect` exists to catch exactly that.

> **1.3 status (2026-11-18): done.**
>
> - **Implementation:** `model.rs` keeps per-instrument state and steps it once per update:
>   - the mid price follows a random walk of at most ±max(1, mid/2000) cents, clamped to [$1, $100,000];
>   - the spread follows its own walk within [1, max(1, mid/500)] cents;
>   - book quantities walk ±50 within 0–1000;
>   - a trade lifts the ask with probability `0.5 + 0.25 × imbalance`, otherwise it hits the bid;
>   - trade quantity is 1–100.
> - **Record layout:** `Update` is `#[repr(C)]` with seven `u32` fields (28 bytes, 4-byte alignment), matching the ABI record.
> - **Tests (8):**
>   - all invariants over 100,000 steps (shared `test_support::assert_invariants`, reused by the producer tests in 1.4);
>   - continuity (each step ≤ `max_mid_step(prev)`, more than 100 distinct mids);
>   - floor (starts at the floor, never goes below it, reaches it at least 10 times);
>   - spread cap;
>   - trades on both sides;
>   - exact `buy_probability` values;
>   - valid initial state for 1,000 seeds;
>   - record size and alignment.
> - **Mutation check:** 8 new mutants (floor removed, spread 0, sells at mid, book unbounded, quantity 0, imbalance sign inverted, 4× mid jumps, buys only), all killed. 15 in total.
> - **Complexity gate:** the first invariant test scored 8 against the limit of 7, because every `assert!` counts as a branch. I split it into price and quantity helpers.

> **1.4 status (2026-11-18): done.**
>
> - **Implementation:** `producer.rs` has `Producer::new(count, seed) -> Option` and `generate(n) -> Option<&[u32]>`, both returning `None` outside [1, 50] and [1, 1000]. That moves the step 1.5 validation into a layer that can be tested safely.
>   - Each update picks a random instrument with `below(count)` and writes `Update::words()` (a fixed 7-word ABI order, now tested) into one buffer that is cleared and reused.
>   - `MAX_INSTRUMENTS` and `MAX_BATCH` live here; `RECORD_WORDS` lives in `model.rs`.
> - **Tests (8):**
>   - (a) lengths for n ∈ {1, 2, 100, 1000};
>   - (b, c) indices < count, every instrument appears in 3 × 1000 updates, and every record satisfies the invariants;
>   - (d) determinism, plus different seeds give different batches;
>   - (e) state retention, checked two ways: 2 × 50 records must be identical to 1 × 100, **and** each instrument's bid continues across batch boundaries (≤ bid/1000 + 2 cents);
>   - the buffer capacity never grows after warm-up;
>   - invalid sizes are rejected.
> - **Why (e) has two checks:** the mutation check showed that "rebuild instrument state on every update" passes the 2 × 50 = 1 × 100 test, since both producers stay in lockstep. Only the continuity check catches it.
> - **Mutation check:** 7 new mutants, 22 in total, all killed.

> **1.5 status (2026-11-18): done.**
>
> - **Implementation:** `abi.rs` holds the 6 exports; `lib.rs` re-exports them along with the limits.
>   - `producer_create` packs the seed as `seed_hi << 32 | seed_lo` and returns `Box::into_raw`, or null.
>   - `producer_generate` and `producer_destroy` are `unsafe extern "C"`, with a `# Safety` contract and a `// SAFETY:` comment on every `unsafe` block (clippy `undocumented_unsafe_blocks` is denied).
>   - A compile-time `const` assert ties `RECORD_WORDS_U32` to the model's `RECORD_WORDS`.
> - **Tests (7):**
>   - invalid counts give null; a null producer and n of 0 or 1001 give null;
>   - generating through the ABI is byte-identical to `Producer::new(4, hi<<32|lo)`;
>   - both seed halves affect the output;
>   - 10,000 create → generate → destroy cycles;
>   - `destroy(null)` is a no-op.
> - **Mutation check:** 3 seed-packing mutants, all killed (25 in total).
> - **Smoke check from Node on the real `.wasm`:** 22,238 bytes; exports are exactly `memory, abi_version, producer_create, producer_destroy, producer_generate, record_words`; records are valid; invalid inputs return 0. Step 1.6 makes this check permanent (`verify-wasm.mjs`).

> **1.6 status (2026-11-18): done.**
>
> - **Scripts:** `scripts/build-wasm.mjs` runs cargo through `cargo.mjs` and copies the module to `public/wasm/producer.wasm` (git-ignored). `scripts/verify-wasm.mjs [path]` checks:
>   - the exact export names **and kinds**;
>   - **no imports**, since the worker instantiates the module with `{}`;
>   - `abi_version() == 1` and `record_words() == 7`;
>   - size ≤ 64 KB;
>   - a 1000-record round trip: every record satisfies the invariants, the same seed gives the same output, and the view is re-created after `generate`;
>   - all invalid inputs return 0.
> - **Control check:** `npm run wasm:build && npm run wasm:verify` → `OK exports=6 size=22238B`.
> - **Failure probes (in `quality-probes.mjs`):** the verifier must reject an empty module (exports mismatch), a copy built with `ABI_VERSION = 2`, and a copy whose trade quantity can be 0 (an invariant break visible only in the records).
> - **Wiring:** `verify` now runs `wasm:build` and `wasm:verify` in place of the old `wasm:compile`.

**Phase 1 gate:** `npm run test:rust && npm run wasm:build && npm run wasm:verify` exit 0.

---

### Phase 2 — Domain core in TypeScript (no Angular)

**Goal:** pure, framework-free modules for settings, symbols, metrics, formatting, Wasm adapter.

| Step | Work                                                                                                                                                                                                                              | Control check                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | `producer-settings.ts`: `DEFAULT_SETTINGS = {5,100,500}`, `SETTINGS_LIMITS`, `validateSettings(x): {ok:true,value}                                                                                                                | {ok:false,errors}`(integers, ranges, finite).`nominalRate(s) = updatesPerBatch*1000/batchIntervalMs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `producer-settings.spec.ts`: defaults equal spec; each boundary (0,1,50,51 / 0,1,1000,1001 / 49,50,2000,2001) accepted/rejected correctly; `1.5`, `NaN`, `Infinity`, `'5'` rejected; `nominalRate(default)===200`                                                                           |
| 2.2  | `symbols.ts`: 50 unique 4-letter uppercase tickers starting `ALFA, BETA`.                                                                                                                                                         | spec: length 50, `new Set(list).size===50`, all match `/^[A-Z]{4}$/`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2.3  | `metrics.ts`: `createAccumulators`, `applyBatch`, `deriveMetrics` (§3.5).                                                                                                                                                         | `metrics.spec.ts` (all via hand-built `Uint32Array`s): **worked example** — trades (10@10000),(30@10200), bid 10196 ask 10200, bq 600 aq 400 ⇒ last 10200, volume 40, vwap 10150, spread 4, imbalance 0.2 (`toBeCloseTo(0.2, 12)`); **empty** ⇒ all null, volume 0; **zero book** (bq=aq=0) ⇒ imbalance null; **isolation** — updates for instrument 1 don't change instrument 0/2; **book qty never counted in volume**; **each trade once** — same batch applied twice ⇒ volume doubles exactly (no hidden dedupe/double count); **O(instruments)** — accumulator array length unchanged after 10 000 updates; **precision** — notional at 2^53−1 boundary stays exact for integer inputs |
| 2.4  | `market-format.ts`: `formatCents(c                                                                                                                                                                                                | null)`→`Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})`of`c/100`, null → `—`; `formatImbalance`→`+0.20`/`−0.35`/`0.00`/`—`, clamps display to [−1,1]; `formatVolume`→ grouped integer. Plus`market-format-pipes.ts`: pure pipes `cents`, `imbalance`, `volume`that only delegate to these functions (skill`pipes.md`).                                                                                                                                                                                                                                                                                                                                                        | spec: `formatCents(10150)==='$101.50'`, `formatCents(4)==='$0.04'`, `formatCents(null)==='—'`, `formatImbalance(0.2)==='+0.20'`, `formatImbalance(-1)==='−1.00'`, `formatVolume(0)==='0'`, `formatVolume(1234567)==='1,234,567'`; pipe spec: `new CentsPipe().transform(10150)==='$101.50'` |
| 2.5  | `wasm-generator.ts` (§3.3). Creates fresh `Uint32Array(memory.buffer, ptr, n*7)` after each call; throws `WasmAbiError` on version mismatch, `RangeError` on null pointer. `dispose` idempotent; `generate` after dispose throws. | `wasm-tests/producer.wasm.test.ts` (Node env, real artefact): batch sizes 1/100/1000 → `length===n*7`; invariants on 50 000 updates; fixed seed ⇒ identical output across two factory instances; invalid count throws; ABI mismatch with a stub module throws `WasmAbiError`; `generate` after `dispose` throws                                                                                                                                                                                                                                                                                                                                                                             |
| 2.6  | Control check that randomness lives in Wasm.                                                                                                                                                                                      | `grep -rnE "Math\.random                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | crypto\.getRandomValues" src/app/core/producer --include=*.ts                                                                                                                                                                                                                               | grep -v spec`→ only`producer-store.ts` (seed source) |

> **2.1 status (2026-11-18): done.**
>
> - **Files:** `engine/producer-settings.model.ts` (`ProducerSettings`, `SettingsLimit`, `SettingsError`, the `SettingsValidation` union) and `engine/producer-settings.ts`:
>   - frozen `DEFAULT_SETTINGS` and `SETTINGS_LIMITS`;
>   - `settingsFieldError(field, value)`, the per-field rule, so the 6.1 form schema can reuse the same messages;
>   - `validateSettings(unknown)`, which reports every bad field and ignores unknown keys;
>   - `nominalRate`.
> - **Tests (27, AAA):** defaults and limits; all 12 boundary values; `1.5`, `NaN`, `Infinity`, `'5'`, `null` and missing values; multi-field errors with range messages; non-object input; `nominalRate(default) === 200`.
> - **Coverage:** **100 %** statements, branches, functions and lines.
> - **Dependency fix found along the way:** installing coverage exposed a supply-chain problem, fixed in a separate commit (`build(deps)`, see the supply-chain gate note in QUALITY_GATES_PLAN).

> **2.2 status (2026-11-18): done.**
>
> - **`symbols.ts`:** a frozen list of 50 fictional tickers (Greek letters, then NATO words), starting `ALFA, BETA`.
> - **Spec (5 tests):** length 50, which equals `SETTINGS_LIMITS.instrumentCount.max`; all unique; all match `/^[A-Z]{4}$/`; the order starts `ALFA, BETA`; the list is frozen.
>
> **2.3 status (2026-11-18): done.**
>
> - **Files:**
>   - `record-layout.ts`: `RECORD_WORDS` and `FIELD` offsets, mirroring Rust `Update::words()`.
>   - `protocol.model.ts`: `InstrumentAccumulatorDto` only for now; Phase 3 adds the message types, because knip rejects unused exports.
>   - `metrics.model.ts`: `InstrumentMetrics`.
>   - `metrics.ts`:
>     - `createAccumulators`: count 1–50, otherwise `RangeError`;
>     - `applyBatch`: O(n), no allocation, throws on an index out of range or `n` larger than the buffer;
>     - `deriveMetrics`: `null` for an empty book, zero volume or a missing quote.
> - **Spec (17 tests):** every plan check passes: the worked example, empty state, a zero book giving `null`, isolation, book quantity never counted in volume, applying a batch twice doubling the sums exactly, O(instruments) after 10,000 updates, and the exact notional at `MAX_SAFE_INTEGER`. Extra tests cover imbalance at ±1/0, `n` smaller than the buffer, and the three error paths.
> - **Coverage:** 100 % lines and 95.7 % branches. The uncovered branch is the `?? 0` that `noUncheckedIndexedAccess` requires after an explicit bounds check.
> - **Notional limit:** `notionalCents` is a `number`. It stays exact up to 2^53; at the worst case (20,000 updates/s, all on one instrument) that bound is reached after about 100 hours.

> **2.4 status (2026-11-18): done.**
>
> - **`shared/format/market-format.ts`:** the only place values are rounded for display. It uses cached `Intl.NumberFormat` instances.
>   - `formatCents`: `$101.50`; half-cents round half away from zero; `null` or `NaN` gives `—`.
>   - `formatImbalance`: `+0.20` / `−0.35` with U+2212, clamped to [−1, 1]. Zero is unsigned, including `-0` and `-0.001`.
>   - `formatVolume`: `1,234,567`.
> - **`market-format-pipes.ts`:** the pure pipes `cents`, `imbalance` and `volume`, which only delegate to those functions, following the skill's `pipes.md`.
>   - Class names keep the `…Pipe` suffix (`CentsPipe`), as `pipes.md` and the plan's check use; a suffixless `FormatCents` would clash with the function `formatCents`.
> - **Tests (28):** every plan value plus rounding, clamping, signed zero and non-finite input. A TestBed host component renders all three pipes and re-renders when its signals change (zoneless: `whenStable`).
> - **Coverage:** 100 % on all measures.
> - **Lint bug found:** the first Angular import in `shared/` exposed a bug in the boundary rule. The glob `**/core` also matched `@angular/core`, so shared code could not use Angular at all. It is fixed with relative-path regexes, and covered by 1 new positive and 2 negative probes (29 lint probes in total).

> **2.5 status (2026-11-18): done.**
>
> - **`engine/wasm-generator.ts`** (interfaces in `wasm-generator.model.ts`):
>   - `createGeneratorFactory(exports)` verifies the ABI: version first, then the five functions, `memory` and `record_words`. Any mismatch throws `WasmAbiError`.
>   - It is split from `loadWasmGeneratorFactory(URL | BufferSource)`, so every branch can be unit-tested with a plain-object stub.
>   - Loading from a URL uses `instantiateStreaming` only when the server sends `application/wasm`, otherwise `arrayBuffer()`, and reports HTTP errors as HTTP errors.
>   - Seed halves and pointers are coerced with `>>> 0`.
>   - `generate` validates `n`, turns a null pointer into `RangeError` and returns a **fresh** `Uint32Array` every call. `dispose` is idempotent, and `generate` after `dispose` throws.
> - **Unit spec (jsdom, 18 tests, 100 % coverage):** view length and offset, seed coercion, idempotent dispose, invalid `n` and count, five ABI-mismatch shapes, the bytes loader, both URL paths (stubbed `fetch`) and HTTP 404.
> - **`npm run test:wasm`** (`wasm-tests/`, Node environment, 10 tests on the **real** module):
>   - batch sizes 1, 100 and 1000;
>   - **50,000 updates** checked against every invariant;
>   - determinism across two factory instances;
>   - invalid counts;
>   - a hand-encoded `abi_version() → 2` stub giving `WasmAbiError`;
>   - generate after dispose;
>   - a **memory-growth test**: after about 4 MB of allocations, a kept view has length 0 (detached), which proves why a fresh view is required.
> - **Wiring:**
>   - `test:wasm` runs in `verify:fast` (pre-push, after an incremental `wasm:build`) and in `verify`;
>   - `wasm-tests/` is type-checked (`lint:types`), linted (`angular.json`) and scanned by knip;
>   - `@types/node@24.19.2` is pinned with `--before`.
> - **knip side effect:** adding `wasm-tests/vitest.config.ts` made knip's Vitest plugin ignore the Angular `*.spec.ts` entries, which then showed up as 15 "unused files". Both entry sets are now declared explicitly in `knip.jsonc`.

**Phase 2 gate:** `npx ng test --watch=false` and `npm run test:wasm` exit 0; coverage of `metrics.ts`, `producer-settings.ts`, `market-format.ts` ≥ 95 % lines (`ng test --coverage`).

> **2.6 status (2026-11-18): done.**
>
> - **Grep:** `grep -rnE 'Math\.random|crypto\.getRandomValues' src/app/core/producer --include='*.ts' | grep -v '\.spec\.ts'` finds **0 matches**. The same grep found a known token, which proves it works.
> - **Why zero is right:** the expected single match is `producer-store.ts`, the seed source, which does not exist until Phase 4.
> - **Repo-wide:** `Math.random` appears 0 times in `src/` and `wasm-tests/`, specs included. The Rust crate has no dependencies.
> - **Kept that way permanently by** the ESLint `Math.random` ban on `core/**` and specs, which has a lint probe.
>
> **Phase 2 gate (2026-11-18): passed.**
>
> - `npx ng test --watch=false --coverage`: **97 tests**; all files **100 % lines and statements**, 99.1 % branches. `metrics.ts` is at 100 % lines and 95.65 % branches; its one uncovered branch is the `noUncheckedIndexedAccess` fallback.
> - `npm run test:wasm`: **10 tests** on the real module.
> - The ≥ 95 % line requirement for `metrics.ts`, `producer-settings.ts` and `market-format.ts` is met (all at 100 %).
> - The thresholds are not yet enforced automatically; that is Q2.1 (`test:ci`).

---

> **Browser check (2026-11-18, Chrome DevTools MCP 1.12.0, Chrome 157, production build):**
>
> - **The shell renders:** the console is clean and all requests return 200. `.wasm` is served as `application/wasm` by both `ng serve` and a static server.
> - **Wasm in Chrome:** it instantiates by streaming in 4 ms and runs at about 11 M updates/s; a maximum batch takes 0.09 ms of its 50 ms budget, with 0 invariant violations.
> - **Warm desktop LCP:** 39–86 ms.
> - **Fixes applied:**
>   - removed the empty global `styles.scss`, which was a render-blocking request (Chrome estimated about 560 ms of savings on Slow 4G);
>   - added `<meta name="description">`.
> - **Results after the fixes:** Lighthouse Accessibility, Best Practices and SEO are all **100**.
> - **The predicted saving did not happen:** throttled LCP stayed about 2.28 s with 4× CPU on Slow 4G. The CSS downloaded in parallel with `main.js`, and LCP waits for JS download plus bootstrap. The real lever is the bundle (190 kB raw, 52 kB transferred).
> - **Follow-up:** once Phases 3–5 exist, trace the live dashboard at maximum settings: long tasks, INP of Pause, and a flat heap.

### Phase 3 — Worker-side engine

**Goal:** a pure-TS state machine handling commands, scheduling, run isolation, cleanup; worker file is a ≤ 30-line adapter.

`ProducerEngine(deps: { loadFactory: () => Promise<GeneratorFactory>; scheduler: Scheduler; clock: Clock; post: (m: FromWorker) => void })`

State: `phase: 'idle'|'loading'|'ready'|'failed'`, `run: { id, settings, generator, acc, seq, paused, timer } | null`. Commands are processed through a **serial promise queue** so `start` awaiting init cannot be overtaken by `pause`.

Behaviour:

- `init` → load factory once; post `ready` or `error{phase:'init', message}` (message includes URL + HTTP status / compile error text).
- `start{runId}` → cancel timer, `dispose()` old generator, create new generator + accumulators, post `status running`, run first batch immediately, then schedule.
- tick → `words = gen.generate(n)`; `applyBatch`; post `snapshot{runId, seq++}`; schedule next with `max(0, interval − elapsed)`.
- `pause{runId}` → ignored if `runId !== run.id`; cancel timer; post `status paused`.
- `resume{runId}` → ignored if stale or not paused; tick scheduled at `interval` from now (no catch-up); post `status running`.
- `dispose` → cancel timer, dispose generator, `self.close()` in adapter.
- Any exception in tick → post `error{phase:'runtime'}`, stop run.

| Step | Work                                                                                                                                                                           | Control check                                                                                                                                                                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | `scheduler.ts`: `Scheduler {schedule(ms, fn): Handle; cancel(h)}`, `Clock {now()}`; real impls + `ManualScheduler` test helper (advance(ms) runs due tasks deterministically). | `scheduler.spec.ts`: tasks run in time order; cancel prevents run                                                                                                                                                                                                                                                |
| 3.2  | `producer-engine.ts` core with `FakeGeneratorFactory` (emits deterministic records, counts `create/dispose`).                                                                  | `producer-engine.spec.ts`: **batch cadence** — after `start` + `advance(500*3)` exactly 4 snapshots (t=0,500,1000,1500); **batch size** passed to `generate` equals `updatesPerBatch`                                                                                                                            |
| 3.3  | Pause/resume.                                                                                                                                                                  | spec: **pause stops generation** — after pause, `advance(10_000)` ⇒ 0 new `generate` calls; **no catch-up** — resume then `advance(499)` ⇒ 0 calls, `advance(1)` ⇒ 1 call; **totals preserved** — volume after resume = before + next batch only                                                                 |
| 3.4  | Run isolation & cleanup.                                                                                                                                                       | spec: **start(run2)** disposes run1 generator exactly once (`dispose` count 1) and cancels its timer (no run1 snapshots after); stale `pause{runId:1}` during run 2 ignored; snapshots of run2 start with `seq=0` and zeroed totals; `dispose` command ⇒ generator disposed, no further posts after `advance(∞)` |
| 3.5  | Ordering & errors.                                                                                                                                                             | spec: `start` sent before `init` resolves is executed after `ready`; `pause` sent right after `start` (before load resolves) leaves run paused with 0 batches; `loadFactory` rejects ⇒ single `error{phase:'init'}` containing the message; generator throwing ⇒ `error{phase:'runtime'}` and timer cancelled    |
| 3.6  | Slow batch handling.                                                                                                                                                           | spec with fake clock where `generate` "takes" 700 ms at interval 500 ⇒ next delay `0`, never two ticks at same time, no burst after                                                                                                                                                                              |
| 3.7  | `producer.worker.ts` adapter + `tsconfig.worker.json` (`lib: ["es2022","webworker"]`) + `"webWorkerTsConfig"` in `angular.json`.                                               | `npx ng build` exit 0 and `ls dist/findev/browser/                                                                                                                                                                                                                                                               | grep -E "^worker-.*\.js$"`returns 1 file;`npx tsc -p tsconfig.worker.json --noEmit` exit 0 |

> **3.1 status (2026-11-18): done.**
>
> - **Files:**
>   - `scheduler.model.ts`: `Scheduler`, `Clock`, `TimerHandle`.
>   - `scheduler.ts`: `realScheduler` (`setTimeout`/`clearTimeout`) and `realClock` (`performance.now`).
>   - `testing/manual-scheduler.ts`: `ManualScheduler`, which implements both interfaces.
>     - Tasks run in due-time order (ties in scheduling order), and `now()` equals the running task's due time.
>     - Tasks scheduled during `advance` run if they fall due within it.
>     - `elapse(ms)` moves time without running tasks, for step 3.6's slow `generate`.
>     - A runaway guard throws on an endless 0 ms loop.
> - **Spec (10 tests):** time order, ties, not-yet-due, cancel, self-rescheduling ticks at 0/500/1000/1500, `elapse`, a negative delay treated as 0, the runaway guard, and the real implementations under Vitest fake timers (no sleeping).
> - **Side fix:** `wasm-tests/tsconfig.json` now includes only `wasm-tests/**`; `tsc` follows imports. Before, it compiled all of `engine/` with Node types, which would have forced a cast on `setTimeout`.

> **3.2–3.6 status (2026-11-18): done (one commit, because the engine is a single cohesive class).**
>
> - **`protocol.model.ts`:** `ToWorker` (init, start with settings and seed `[lo,hi]`, pause, resume, dispose) and `FromWorker` (ready, snapshot with `runId`, `seq`, instruments and stats {batches, updates, lastBatchMs}, status, error {runId|null, phase, message}).
> - **`producer-engine.ts`:**
>   - Commands run through a serial promise queue.
>   - The factory loads once. `start` stops the old run (cancels its timer, disposes its generator), validates the settings again, and schedules the first batch at 0 ms.
>   - Each tick generates, then calls `applyBatch`, posts a copied snapshot, and schedules the next one after `max(0, interval − elapsed)`.
>   - Resume schedules the next batch a full interval later.
>   - Any exception stops the run and posts `error{phase:'runtime'}`.
>   - `dispose` stops the run and silences everything after it.
> - **Test helpers:** `testing/fake-generator.ts` counts create, generate and dispose calls, and throws if used after dispose, like the real adapter. `testing/engine-harness.ts` wires the engine to `ManualScheduler`.
> - **Specs (23 tests):**
>   - `producer-engine.spec.ts`: cadence 0/500/1000/1500; batch size; pause, plus no catch-up (+499 → 0 batches, +500 → 1); totals preserved across pause; a single batch chain after pause and resume; run isolation; dispose.
>   - `producer-engine-ordering.spec.ts`: start before ready; pause before load; init and runtime errors; invalid settings; a slow 700 ms batch gives batch starts at 0/700/1400/1900/2400.
> - **Mutation check:** 10 injected engine bugs, all caught. They covered slow-batch compensation, resume catch-up, missing dispose, a leaked pause timer, a synchronous first batch, `seq` off by one, shared accumulators, dispose not stopping, reload on every init, and an error that doesn't stop the run. The leaked pause timer first survived and needed the new single-chain test.

> **3.7 status (2026-11-18): done.**
>
> - **`producer.worker.ts`:** a 22-line adapter that builds `ProducerEngine` with the real scheduler and clock and `loadWasmGeneratorFactory`, and calls `close()` after `dispose`.
> - **`tsconfig.worker.json`:** `lib: ["es2022","webworker"]`, includes `src/**/*.worker.ts`. `tsconfig.app.json` excludes worker files, the root `tsconfig.json` references the new config, and it is part of `lint:types`.
> - **`angular.json`:** `build.options.webWorkerTsConfig`. The `unit-test` builder has no such option.
> - **knip:** `src/**/*.worker.ts` is declared as an entry point.
> - **Checks:**
>   - `tsc -p tsconfig.worker.json` exits 0.
>   - With a temporary `new Worker(new URL(...))` reference, `ng build` emits `worker-*.js` (6.6 kB, containing the Wasm adapter). The reference was removed afterwards.
>   - The permanent `worker-*.js` build check moves to 4.1, where `WORKER_FACTORY` is the only allowed `new Worker` call.
> - **Side fix:** the jscpd and core-coverage self-test probes had started to pass silently, because the codebase outgrew their fixed sizes. Both now size themselves from the current code: 5 % duplicated lines, and untested lines calculated from a clean coverage baseline.
>
> **Phase 3 gate (2026-11-18): passed.** `ng test --watch=false`: 130 tests in 1.2 s (wall time 2 s, limit 30 s). Full `npm run verify` exit 0.

**Phase 3 gate:** `npx ng test --watch=false` exit 0; total test wall time < 30 s (`time npx ng test --watch=false`) — proves no real-time waits.

---

### Phase 4 — Main-thread store (`ProducerStore`)

| Step | Work                                                                                                                                                                                                                                                                                                                                                          | Control check                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1  | `producer-tokens.ts`: `InjectionToken`s `WORKER_FACTORY`, `SEED_SOURCE`, `WASM_URL`, each with a `factory` default (skill `defining-providers.md`). The `WASM_URL` default is `new URL('wasm/producer.wasm', document.baseURI).href`. Tests override them with `{provide, useValue}`. `FakeWorker` test double records `postMessage` and exposes `emit(msg)`. | type-check passes                                                                                                                                                                                                                                     |
| 4.2  | `ng generate service core/producer/producer-store`, then convert it to `@Service()` with private signals and `.asReadonly()`. Bootstrap: `provideAppInitializer(() => inject(ProducerStore).boot())` → create worker once, send `init` then `start{runId:1, DEFAULT_SETTINGS}`; rows = empty accumulators for 5 instruments.                                  | `producer-store.spec.ts`: after boot, worker factory called **exactly once**; messages `[init, start(runId=1, defaults)]`; `rows().length===5`, all `lastPriceCents===null`, `volume===0`; `status()==='initializing'` until `ready`+`status running` |
| 4.3  | Snapshot handling with run gate.                                                                                                                                                                                                                                                                                                                              | spec: snapshot `runId===current` updates rows; **stale snapshot (runId 1 after apply ⇒ runId 2) is dropped** — rows remain zeroed; snapshot with `seq` ≤ last seen ignored                                                                            |
| 4.4  | `apply(settings)`: `validateSettings` (throws on invalid — UI never calls with invalid), `runId++`, settings signal set, rows reset to `instrumentCount` empty rows **synchronously**, send `start`. Works from paused.                                                                                                                                       | spec: after apply from paused ⇒ last message `start{runId:2}`, `status()` becomes `running` on worker ack; rows length = new count, all empty; stats reset                                                                                            |
| 4.5  | `pause()/resume()`: send with current runId; optimistic `status` update, reconciled by worker `status` messages.                                                                                                                                                                                                                                              | spec: pause ⇒ message `{pause, runId}`; double pause sends once; resume from running is no-op                                                                                                                                                         |
| 4.6  | Throughput stat: updates/s computed from snapshot `stats.updates` deltas over a 1 s sliding window using injected `Clock`.                                                                                                                                                                                                                                    | spec with fake clock: 2 snapshots of 100 updates 500 ms apart ⇒ `200`                                                                                                                                                                                 |
| 4.7  | Errors & cleanup: `worker.onerror`, `onmessageerror`, `error` messages ⇒ `status='error'`, `error()` message. `retry()` terminates old worker, creates new one, re-sends init+start with **new** runId. `DestroyRef.onDestroy` ⇒ send `dispose` + `terminate()`.                                                                                              | spec: init error sets human-readable message; `retry` ⇒ factory call count 2, old `terminate` called once; `TestBed.resetTestingModule()` (destroys root injector) ⇒ `terminate` called                                                               |
| 4.8  | Navigation invariant.                                                                                                                                                                                                                                                                                                                                         | spec using `RouterTestingHarness` with the real `routes` (no Router mocks, per skill `router-testing.md`): navigate dashboard→settings→dashboard ×5 ⇒ factory call count still 1; status preserved (pause, navigate, still paused)                    |

**Phase 4 gate:** `npx ng test --watch=false` exit 0; `grep -rn "new Worker" src/app | grep -v spec` → exactly 1 hit (`worker-factory.ts`).

---

### Phase 5 — Dashboard page

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Control check                                                                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | `ng generate component features/dashboard/components/metrics-table`. `MetricsTable` takes `rows = input.required<InstrumentMetrics[]>()`. Default OnPush, so don't set `changeDetection`. Cells use the `cents`/`imbalance`/`volume` pipes, not method calls. columns Symbol · Last · Spread · Volume · VWAP · Imbalance; `@for (r of rows(); track r.symbol)`; numeric columns right-aligned, `font-variant-numeric: tabular-nums` (no jitter at 20 Hz); imbalance coloured by sign with text sign too (not colour-only). | spec (`fixture.componentRef.setInput('rows', …)` → `await fixture.whenStable()` → assert): given worked-example metrics ⇒ cells `$102.00`, `$0.04`, `40`, `$101.50`, `+0.20`; given empty row ⇒ `—`,`—`,`0`,`—`,`—` |
| 5.2  | `ProducerStatus` (`components/producer-status.ts`): status pill (`@switch (status())` with `@default never;` for exhaustive typing) (Initializing/Running/Paused/Error), run #, settings summary, nominal vs measured updates/s, batches; Pause/Resume button (label/`aria-pressed` reflect state; disabled while initializing/error).                                                                                                                                                                                     | spec: running ⇒ button text `Pause`; click ⇒ `service.pause()` called; paused ⇒ `Resume`; error ⇒ alert region with message + `Retry`                                                                               |
| 5.3  | `Dashboard` (`features/dashboard/dashboard.ts`) composes both with self-closing tags and reads signals from `ProducerStore` via `inject()`.                                                                                                                                                                                                                                                                                                                                                                                | spec with a stub store (`{provide: ProducerStore, useValue: stub}`): renders N rows for N instruments                                                                                                               |
| 5.4  | Accessibility: `<table>` with `<caption>`, `scope="col"`; status in `role="status" aria-live="polite"` (only status text, **not** the live table, to avoid screen-reader flooding).                                                                                                                                                                                                                                                                                                                                        | spec asserts `caption` exists and `role="status"` present                                                                                                                                                           |

**Phase 5 gate:** tests pass; `npx ng build` within budgets (initial < 500 kB warning budget).

---

### Phase 6 — Settings page

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Control check                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1  | `settingsSchema` in `features/settings/settings-schema.ts` (Signal Forms `schema()`): for each field, `required` + `min`/`max` from `SETTINGS_LIMITS` with messages `Must be between X and Y`, plus `validate(path, ({value}) => Number.isInteger(value()) ? undefined : {kind:'integer', message:'Must be a whole number'})`. Validators return `undefined` when valid, never `null`.                                                                                                                                                                                                                                               | spec (pure, no TestBed DOM): `form(signal({...DEFAULT_SETTINGS}), settingsSchema)` valid; `instrumentCount=0` ⇒ `errors()[0].kind==='min'`; `=1.5` ⇒ `getError('integer')` defined; `=NaN` (empty input) ⇒ invalid; boundaries 1/50, 1/1000, 50/2000 valid |
| 6.2  | `Settings` (`features/settings/settings.ts`, imports `FormField`): draft model `linkedSignal(() => ({...store.settings()}))`, so the form re-syncs when the applied settings change and is otherwise a local copy. `settingsForm = form(this.draft, settingsSchema)`. Inputs `<input type="number" step="1" inputmode="numeric" [formField]="settingsForm.instrumentCount">` with **no** `min`/`max`/`[value]`/`[disabled]` attributes (forbidden by the skill), labels, hints showing ranges, errors shown on touched/dirty (`aria-describedby`). Live "Nominal rate: 200 updates/s" is a `computed` over `settingsForm().value()`. | spec (set values through input DOM events → `whenStable` → assert): initial values `5/100/500`; set `0` ⇒ form invalid + error text `Must be between 1 and 50`; set `1.5` ⇒ `Must be a whole number`; Apply button disabled when invalid                   |
| 6.2b | Remove the temporary `"ignoreDependencies": ["@angular/forms"]` from `knip.jsonc`, since `@angular/forms/signals` is now used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `grep -c '@angular/forms' knip.jsonc` → `0`; `npm run deadcode` exit 0                                                                                                                                                                                     |
| 6.3  | Editing doesn't affect producer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | spec: change values, don't click Apply ⇒ `service.apply` not called (spy) and `service.settings()` unchanged                                                                                                                                               |
| 6.4  | Apply → `submit(settingsForm, async () => store.apply(draft()))` (the callback must be `async`), then `settingsForm().reset()`, confirmation "Run #N started with …". "Reset to defaults" fills form only.                                                                                                                                                                                                                                                                                                                                                                                                                           | spec: Apply with valid values ⇒ `apply` called once with integers `{10,200,250}`; reset-to-defaults (`draft.set({...DEFAULT_SETTINGS})`) ⇒ form values default, `apply` not called; submitting an invalid form ⇒ `apply` not called and all fields touched |
| 6.5  | Integration (real `ProducerStore` + `FakeWorker`): apply ⇒ dashboard rows cleared and stale snapshot rejected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | spec: emit snapshot run1 with volume 40 ⇒ apply ⇒ rows volume 0 ⇒ emit another run1 snapshot ⇒ still 0 ⇒ emit run2 snapshot ⇒ updated                                                                                                                      |

**Phase 6 gate:** `npx ng test --watch=false` exit 0.

---

### Phase 7 — Shell, routing, error UX

| Step | Work                                                                                                                                                                                                                                                                        | Control check                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 7.1  | Routes: `''`→`dashboard` redirect, `dashboard`, `settings` (`loadComponent` lazy), `**`→`dashboard`. `withComponentInputBinding()` not needed. `app.html` shell: header nav with `RouterLink` + `routerLinkActive`, `<router-outlet />`, status pill visible on both pages. | `app.routes.spec.ts` with `RouterTestingHarness` + real `routes`: `/unknown` → `/dashboard`; `/settings` renders `Settings` |
| 7.2  | Global init-error banner (from `service.error()`), with Retry.                                                                                                                                                                                                              | spec: service in error ⇒ banner text contains message and Retry triggers `retry()`                                          |
| 7.3  | Minimal responsive styling (table scrolls horizontally on narrow screens, ≥ 44 px touch targets). Keep component styles < 4 kB budget.                                                                                                                                      | `npx ng build` no budget warnings                                                                                           |

**Phase 7 gate:** `npm run verify` exit 0 **and** every grep in §4.0 "Control checks for the standard" returns empty.

---

### Phase 8 — Repository, CI/CD, README

| Step | Work                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Control check                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 8.1  | Create GitHub repo (public), push `main` with full history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `git ls-remote origin main` returns the local `HEAD` SHA                                             |
| 8.2  | `.github/workflows/ci-deploy.yml`: on `push` (all branches) + `pull_request`: checkout → `actions/setup-node` (`node-version-file: .nvmrc`, npm cache) → Rust via `rust-toolchain.toml` (`dtolnay/rust-toolchain` + `Swatinem/rust-cache`) → `npm ci` → `npm run test:rust` → `npm run wasm:build` → `npm run wasm:verify` → `npm run test:wasm` → `npx ng test --watch=false` → `npx ng build --base-href "/${{ github.event.repository.name }}/"` → `cp dist/findev/browser/index.html dist/findev/browser/404.html` → `actions/upload-pages-artifact`. Job `deploy` (`needs: build`, `if: github.ref == 'refs/heads/main'`, `permissions: pages: write, id-token: write`, `concurrency: pages`) → `actions/deploy-pages`. | Workflow run on push is green (`gh run list --limit 1` → `completed success`)                        |
| 8.3  | Enable Pages "Source: GitHub Actions".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `gh api repos/{owner}/{repo}/pages --jq .build_type` → `workflow`                                    |
| 8.4  | `scripts/smoke-deploy.mjs <url>`: GET `/` 200 and contains `<app-root`; GET `/wasm/producer.wasm` 200 with `content-type: application/wasm`; GET `/settings` (deep link) 200/404-with-app-shell. Run as last CI step after deploy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | CI step exit 0                                                                                       |
| 8.5  | Auto-deploy proof: push a trivial commit (e.g. version string in footer), wait for workflow, smoke script sees new string.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Live page footer shows new short SHA (inject `GITHUB_SHA` at build via `define` or environment file) |
| 8.6  | README: overview, architecture diagram (Mermaid: Angular ⇄ worker ⇄ Wasm), decisions & trade-offs (summarise §1), prerequisites (Node 24, rustup), commands (`npm ci`, `npm start`, `npm test`, `npm run test:rust`, `npm run test:wasm`, `npm run verify`), live demo + repo links, data model & formulas, known limits (precision note D5, deploy only from `main`).                                                                                                                                                                                                                                                                                                                                                       | README contains all commands; each command run copy-paste on clean clone exits 0                     |

**Phase 8 gate:** fresh clone in temp dir → follow README verbatim → `npm run verify` exit 0; live URL passes smoke script.

---

### Phase 9 — Hardening, performance & interview readiness

| Step | Work                                                                                                                                              | Control check                                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1  | Max-load check: apply `50 / 1000 / 50` (20 000 updates/s). Chrome DevTools Performance 10 s recording.                                            | Main thread: no long tasks > 50 ms attributable to app; measured updates/s within ±10 % of nominal; worker batch time (`stats.lastBatchMs`) < 5 ms |
| 9.2  | Memory: 5-minute run at max load.                                                                                                                 | Heap snapshot growth < 2 MB after GC (no history retention); `grep -rnE "\.push\(" src/app/core/producer --include=*.ts                            | grep -v spec` → no push of updates into long-lived arrays |
| 9.3  | Error path manual check: rename wasm URL via DevTools override / block request.                                                                   | UI shows "Failed to load market data engine (HTTP 404 …)" + Retry works after unblocking                                                           |
| 9.4  | Background tab: switch away 30 s, return.                                                                                                         | No burst of catch-up batches; totals continue                                                                                                      |
| 9.5  | Requirement traceability: every row R1–R24 has a passing test or a documented manual check.                                                       | Checklist in README "Requirements coverage" fully ticked                                                                                           |
| 9.6  | Interview extension rehearsal (prove architecture is flexible): e.g. add a 6th metric (trade count), add sorting, add per-instrument price flash. | Each is ≤ 1 file change in the relevant layer; tests still pass                                                                                    |

**Final gate (Definition of Done):**

1. `npm run verify` exit 0 locally and in CI.
2. Live demo loads, shows 5 instruments updating, Pause/Resume works, Apply resets.
3. All R1–R24 traced.
4. Commit history shows phased development (≥ 1 commit per step).

---

## 5. Test inventory (maps to §4 of the task)

| Task requirement                                                             | Suite                                                                                                | Key cases                                                                                                                                            |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metric calculations, worked example, zero denominators, instrument isolation | `metrics.spec.ts`, `market-format.spec.ts`, `metrics-table.spec.ts`                                  | worked example exact numbers; empty ⇒ unavailable + volume 0; bq+aq = 0 ⇒ imbalance unavailable; instrument isolation; book qty excluded from volume |
| Settings validation & reset on apply                                         | `producer-settings.spec.ts`, `settings-schema.spec.ts`, `settings.spec.ts`, `producer-store.spec.ts` | boundaries, non-integers, required; editing doesn't apply; apply resets rows/stats and increments runId; apply from paused starts running            |
| Pause/resume & stale-run rejection                                           | `producer-engine.spec.ts`, `producer-store.spec.ts`                                                  | no generation while paused; no catch-up; totals preserved; stale snapshot / stale command ignored                                                    |
| Generator behaviour                                                          | Rust `cargo test` + `wasm-tests/producer.wasm.test.ts`                                               | exact batch sizes; invariants on 100k updates; determinism by seed; state continuity across calls; invalid input handling                            |

All time-dependent tests use `ManualScheduler`/fake `Clock`; all randomness uses fixed seeds. No test sleeps.

---

## 6. Risk register

| Risk                                                                       | Likelihood        | Impact                                 | Mitigation                                                                                     |
| -------------------------------------------------------------------------- | ----------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Wasm 404 on GitHub Pages sub-path                                          | High if unhandled | App dead                               | URL from `document.baseURI` (D4); smoke test checks `/wasm/producer.wasm`                      |
| Detached `ArrayBuffer` after memory growth                                 | Medium            | Wrong/empty reads                      | Re-create view after every `generate`; Wasm test with growing batch sizes 1→1000               |
| Stale run data leak                                                        | Medium            | Spec violation                         | `runId` gate on both sides; dedicated tests (3.4, 4.3, 6.5)                                    |
| Angular 22 / Vitest 5 API drift (worker config, unit-test builder options) | Medium            | Build/test friction                    | Verify each config change with gate commands immediately; keep worker logic outside Angular    |
| Rust not installed for reviewers locally                                   | Medium            | Can't build                            | README prerequisites; `prestart` prints clear message if `cargo` missing; CI builds everything |
| Timer throttling in background tabs                                        | Low               | Lower throughput while hidden          | Accepted; start-to-start scheduling prevents bursts (9.4)                                      |
| Float precision of notional (D5)                                           | Very low          | Sub-cent error after ~12 h at max load | Documented; boundary test                                                                      |

---

## 7. Suggested commit sequence (abridged)

```
chore: pin node, rust toolchain, strict TS, scripts
feat(wasm): pcg32 rng with seeded determinism
feat(wasm): instrument price/book model with invariants
feat(wasm): producer batch buffer and C ABI
build(wasm): build + verify scripts, wasm in public/
feat(core): settings defaults and validation
feat(core): metric accumulator and derivation
feat(core): market formatters + pipes
feat(core): wasm generator adapter + node wasm tests
feat(worker): producer engine with injectable scheduler
feat(worker): pause/resume, run isolation, cleanup
feat(app): producer service with run gating
feat(dashboard): metrics table + status
feat(settings): validated form with apply/reset
feat(app): routing, shell, error banner
ci: build, test, deploy to GitHub Pages
docs: README with architecture and decisions
```
