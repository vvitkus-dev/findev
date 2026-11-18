# Realtime Fintech Dashboard — Implementation Plan

> Status: ready for implementation · Baseline: Angular 22.2 (zoneless, standalone), TypeScript 6.0, Vitest 5 via `@angular/build:unit-test`, Node 24 (`.nvmrc`).
> Repo state at planning time: fresh `ng new` scaffold, single commit `ec77f8e`, no Rust toolchain installed locally.

---

## 0. Requirement analysis

### 0.1 Requirements decomposed into testable statements

| ID | Requirement (normalised) | Source | Verified by |
|---|---|---|---|
| R1 | Two pages: Dashboard, Settings; navigation between them | §1, §2 | component tests + manual |
| R2 | One table row per instrument; 5 metrics: last price, spread, volume, VWAP, imbalance | §1 | `metrics.spec.ts`, `metrics-table.component.spec.ts` |
| R3 | Volume & VWAP cumulative since run start; every trade counted exactly once; book quantities never contribute to volume | §1, §3 | `metrics.spec.ts` |
| R4 | Before data: unavailable values + volume 0. Zero denominator ⇒ unavailable | §1 | `metrics.spec.ts`, `formatters.spec.ts` |
| R5 | Prices formatted as currency; imbalance in [−1, +1] | §1 | `formatters.spec.ts` |
| R6 | Pause/Resume; pausing stops generation; resume keeps totals; no data for paused interval (no catch-up) | §1 | `producer-engine.spec.ts`, `producer.service.spec.ts` |
| R7 | Basic producer status | §1 | `producer-status.component.spec.ts` |
| R8 | Settings form: 3 integer fields, defaults 5/100/500, ranges 1–50 / 1–1000 / 50–2000 | §2 | `settings.spec.ts`, `settings.page.spec.ts` |
| R9 | Editing does not affect producer; **Apply** starts a new run, clears values/totals, starts even if paused | §2 | `settings.page.spec.ts`, `producer.service.spec.ts` |
| R10 | App starts with defaults (running) | §2 | `producer.service.spec.ts` |
| R11 | Navigation preserves run + running/paused; never creates extra producers | §2 | `producer.service.spec.ts` (worker factory call count) |
| R12 | Results from previous run never overwrite new run state | §2 | `producer.service.spec.ts`, `producer-engine.spec.ts` |
| R13 | Wasm generates **market updates** (trade + bid/ask snapshot); randomness & price logic in Wasm | §3 | Rust tests + `grep` control check (no `Math.random` in producer path) |
| R14 | Generator keeps per-instrument state; returns batches of requested size; prices evolve from previous values | §3 | Rust tests, `wasm-abi.test.ts` |
| R15 | Invariants: price > 0, bid < ask, tradeQty > 0, book qty ≥ 0, trade price ∈ {bid, ask} | §3 | Rust property-style tests + `wasm-abi.test.ts` |
| R16 | Wasm runs inside a Web Worker | §3 | build artefact check + code review gate |
| R17 | Integer cents everywhere; rounding only at display | §3 | `metrics.spec.ts`, review gate |
| R18 | No full event history retained; UI may refresh slower than production but all trades counted | §3 | `metrics.spec.ts` (O(instruments) state), review gate |
| R19 | UI stays usable at high rates (max = 1000 updates / 50 ms = 20 000 updates/s) | §3 | Phase 9 performance check |
| R20 | Meaningful init errors; producer resources cleaned up on replace/destroy | §3 | `producer-engine.spec.ts`, `producer.service.spec.ts` |
| R21 | Unit tests: metrics, settings+reset, pause/resume+stale rejection, generator | §4 | test suites listed above |
| R22 | Tests use fixed inputs / controllable deps; no long real-time waits | §4 | injected scheduler + seeded RNG; CI test duration gate |
| R23 | Public GitHub repo, README (build/run/test), incremental commit history | §5 | Phase 8 checks |
| R24 | Every push auto-builds and redeploys; live demo link | §5 | Phase 8 checks |

### 0.2 Derived / implicit requirements (things the spec implies but does not spell out)

- **D1 — Run identity.** "Results from a previous run must not overwrite the new run's state" ⇒ every message carries a monotonically increasing `runId`; both worker and main thread discard mismatched messages.
- **D2 — Deterministic generator.** Tests need fixed inputs ⇒ generator takes an explicit 64-bit seed. Production seeds come from `crypto.getRandomValues` (entropy source only; all random *draws* happen in Wasm).
- **D3 — Controllable time.** "No long real-time waits" ⇒ the worker-side engine never calls `setTimeout` directly; it uses an injected `Scheduler` + `Clock`.
- **D4 — Base-href-safe Wasm URL.** GitHub Pages serves under `/<repo>/` ⇒ the Wasm URL is resolved from `document.baseURI` on the main thread and passed to the worker.
- **D5 — Number precision.** `Σ(price×qty)` in cents stays an exact integer in `float64` while `< 2^53 ≈ 9.0e15`. Worst case per instrument (1 instrument, 20 000 updates/s, price ≈ 1e5 cents, qty ≤ 100) ≈ 2e11 cents/s ⇒ exact for ~12.5 h; beyond that relative error ≈ 1e-16, invisible after rounding to cents. Decision: plain `number`, documented, with a unit test at the boundary. (BigInt rejected: 10–50× slower in the hot loop, no visible benefit.)
- **D6 — Status model.** `initializing → running ⇄ paused`, any → `error`. Shown on dashboard with run number and measured throughput.
- **D7 — Scheduling semantics.** "Requested time between batches" ⇒ start-to-start interval; if a batch takes longer than the interval, the next one starts immediately but never *bursts* to catch up.

### 0.3 Ambiguities and the decision taken

| Ambiguity | Decision | Rationale |
|---|---|---|
| Is a batch generated *before* pause but delivered after it valid? | **Accept** it (same `runId`). | Those trades were generated in the current run; dropping them would violate "every generated trade must contribute". Pause stops *generation*, not delivery of what was already generated. |
| Should Apply navigate to dashboard? | Stay on Settings, show "Run #N started" confirmation. | Least surprise; user may tweak further. Interviewer can change in 1 line. |
| Settings form when re-visited | Shows the **active (applied)** settings; unsaved drafts are discarded on navigation. | Form must reflect producer truth; persisting drafts is not required. |
| Symbols for 50 instruments | Fixed, deterministic list of 50 four-letter tickers (`ALFA, BETA, GAMA, DLTA, …`) mapped by index. | Wasm only emits `u32` instrument index; no strings cross the boundary. |
| "Each push must redeploy" | Deploy on every push to `main`; other branches run build+test only. | Interview changes go to `main`; avoids racing deployments from branches to one Pages site. Documented in README. |

---

## 1. Architecture decisions & trade-offs

### 1.1 Wasm language / toolchain

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Rust** (`wasm32-unknown-unknown`, cargo) | Industry standard for Wasm; zero-runtime output (~10–25 KB); `cargo test` gives native, fast generator tests; strong types; rustup preinstalled on GitHub runners | Extra local toolchain (rustup); learning curve for reviewers | **Chosen** |
| AssemblyScript | npm-only toolchain, TS-like syntax familiar to Angular devs | Weaker credibility as "real Wasm" ("TS wrapped in Wasm" perception); thinner test ecosystem; less common in production | Rejected — risk of failing "not a trivial wrapper" perception |
| C/C++ + Emscripten | Mature | Heavy SDK (~1 GB), generated JS glue, slower CI | Rejected |
| Zig / TinyGo | Small outputs | Niche, less explainable, smaller ecosystem | Rejected |

### 1.2 JS ↔ Wasm interface

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| `wasm-bindgen` + `wasm-pack` | Ergonomic, generates TS types | Generated JS glue must be bundled into the worker; extra tool; returning arrays copies; harder to explain bytes-level | Rejected |
| **Raw C ABI** (`#[no_mangle] extern "C"`), records written into linear memory, JS reads a `Uint32Array` view | Zero copies, zero glue, ~6 exported functions, fully explainable, loads with plain `WebAssembly.instantiate` in both browser worker and Node tests | Manual pointer handling; must re-create views if memory grows | **Chosen** |

Rules for the raw ABI (enforced by tests):
1. Every exported function is listed in `ABI_EXPORTS` and verified by `scripts/verify-wasm.mjs`.
2. JS creates the `Uint32Array` view **after** every `generate` call (memory may grow → old `ArrayBuffer` detached).
3. `abi_version()` export guards against stale artefacts.

### 1.3 Batch transport format inside the worker

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| JSON / JS objects per update | Readable | 20 000 allocations/s, GC pressure | Rejected |
| Struct-of-arrays (7 pointers) | Vectorisable | 7 views to manage | Rejected (complexity, no gain at this scale) |
| **Array-of-structs, 7 × `u32` per update (28 bytes)** | One pointer, one view, trivially iterable | — | **Chosen** |

Record layout (`#[repr(C)]`, little-endian `u32`): `[instrument, priceCents, tradeQty, bidCents, askCents, bidQty, askQty]`.

### 1.4 Where metrics are calculated

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| In Wasm | Fastest | Metric tests (worked example) would live in Rust; duplicating snapshot export ABI; harder for Angular reviewers | Rejected |
| On main thread from raw batches | Simple worker | Up to 28 KB × 20/s transferred and folded on UI thread; stale-run batches must be rolled back | Rejected |
| **In the worker (TS accumulator), main thread receives O(instruments) snapshots** | Main thread only renders; transfer ≤ 50 small records per batch; accumulator is a pure TS module → easy Vitest tests; stale snapshots simply dropped | Accumulated state lives in worker (main has a copy via snapshots) | **Chosen** |

Split: **accumulation** (`applyBatch` → raw sums) in worker; **derivation** (`deriveMetrics` → spread, VWAP, imbalance, nulls) is a pure function used by the main thread. Both in `metrics.ts`, both unit-tested.

### 1.5 Worker lifecycle across runs

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| New worker per Apply | Strongest isolation | Re-fetch/compile Wasm each Apply; more lifecycle code paths; still needs `runId` because tests demand it | Rejected |
| **One long-lived worker per app, one Wasm generator instance per run** (`producer_destroy` old → `producer_create` new) | Navigation can never create producers; cleanup per run is explicit and testable; cheap Apply | Must guard with `runId` (required anyway) | **Chosen** |

Worker is recreated only by the explicit "Retry" action after a fatal init error. Worker is terminated when the root injector is destroyed.

### 1.6 Scheduling

| Option | Verdict |
|---|---|
| `setInterval` | Rejected — overlapping ticks / bursts after throttling. |
| Main-thread timer sending "generate" commands | Rejected — couples generation to UI-thread jank. |
| **Worker-side self-rescheduling `setTimeout` via injected `Scheduler`**, delay = `max(0, interval − elapsed)` | **Chosen** — no overlap, no catch-up bursts, testable with a manual scheduler. |

### 1.7 State management & change detection

| Option | Verdict |
|---|---|
| NgRx Store | Rejected — heavy for one feature; more to explain than to gain. |
| RxJS `BehaviorSubject` service | Viable, but more boilerplate in zoneless templates. |
| **Root `ProducerService` with Angular signals (`signal`, `computed`)** | **Chosen** — idiomatic Angular 22, zoneless-friendly, worker messages update signals → OnPush views re-render only bound text nodes. |

UI refresh rate: worker posts ≤ 1 snapshot per batch ⇒ ≤ 20 Hz worst case. Main thread stores only the *latest* snapshot (no queue). Optional coalescing via `requestAnimationFrame` documented as a lever but not needed at 20 Hz × 50 rows.

### 1.8 Forms

| Option | Verdict |
|---|---|
| Template-driven | Rejected — validation harder to unit-test. |
| Signal Forms | Rejected for submission — newer API, higher risk of version churn; fine to discuss. |
| **Typed Reactive Forms (`NonNullableFormBuilder`)** + custom `integerValidator` | **Chosen** — stable, explicit, trivially testable. |

### 1.9 Hosting / CD

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **GitHub Pages via GitHub Actions** | Same platform as repo; no third-party account linking; Rust + Node on same runner; serves `.wasm` as `application/wasm` | Sub-path (`/<repo>/`) needs `--base-href`; no SPA fallback ⇒ copy `index.html` → `404.html` | **Chosen** |
| Cloudflare Pages | SPA fallback, previews | Its build image needs Rust installed manually; external account | Alternative |
| Vercel | Previews | Same Rust issue; external account | Alternative |

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
│   │   ├── protocol.ts                 # message types (main ⇄ worker)
│   │   ├── settings.ts                 # defaults, limits, validateSettings()
│   │   ├── symbols.ts                  # 50 deterministic tickers
│   │   ├── metrics.ts                  # accumulator + applyBatch + deriveMetrics
│   │   ├── scheduler.ts                # Scheduler/Clock interfaces + real impls
│   │   ├── wasm-generator.ts           # WebAssembly adapter (no Angular deps)
│   │   ├── producer-engine.ts          # worker-side state machine (pure TS)
│   │   ├── producer.worker.ts          # thin adapter: self.onmessage → engine
│   │   ├── worker-factory.ts           # InjectionToken<() => Worker>
│   │   └── producer.service.ts         # root signals store, runId gate
│   ├── shared/format/formatters.ts     # currency, imbalance, volume, "—"
│   └── features/
│       ├── dashboard/  dashboard.page.ts, metrics-table.component.ts, producer-status.component.ts
│       └── settings/   settings.page.ts, integer.validator.ts
├── .github/workflows/ci-deploy.yml
└── README.md
```

---

## 3. Key contracts (write these first; everything else depends on them)

### 3.1 Wasm ABI (`wasm/producer/src/lib.rs`)

```rust
pub const ABI_VERSION: u32 = 1;
pub const RECORD_WORDS: u32 = 7;          // u32 words per update record
pub const MAX_INSTRUMENTS: u32 = 50;
pub const MAX_BATCH: u32 = 1000;

#[no_mangle] pub extern "C" fn abi_version() -> u32;
#[no_mangle] pub extern "C" fn record_words() -> u32;
/// Returns 0 (null) when instrument_count ∉ [1, MAX_INSTRUMENTS].
#[no_mangle] pub extern "C" fn producer_create(instrument_count: u32, seed_lo: u32, seed_hi: u32) -> *mut Producer;
/// Writes exactly `n` records into the producer-owned buffer; returns pointer to first record.
/// Returns 0 when producer is null or n ∉ [1, MAX_BATCH].
#[no_mangle] pub extern "C" fn producer_generate(p: *mut Producer, n: u32) -> *const u32;
#[no_mangle] pub extern "C" fn producer_destroy(p: *mut Producer);
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
  dispose(): void;              // idempotent
}
export interface GeneratorFactory {
  create(instrumentCount: number, seed: readonly [number, number]): MarketGenerator;
}
export async function loadWasmGeneratorFactory(source: URL | ArrayBuffer): Promise<GeneratorFactory>;
// - verifies abi_version() === 1 and record_words() === 7, else throws WasmAbiError
// - instantiateStreaming when URL + correct MIME, falls back to arrayBuffer() + instantiate
```

### 3.4 Worker protocol (`protocol.ts`)

```ts
export interface ProducerSettings { instrumentCount: number; updatesPerBatch: number; batchIntervalMs: number; }

export type ToWorker =
  | { type: 'init'; wasmUrl: string }
  | { type: 'start'; runId: number; settings: ProducerSettings; seed: [number, number] }
  | { type: 'pause'; runId: number }
  | { type: 'resume'; runId: number }
  | { type: 'dispose' };

export interface InstrumentAccumulatorDto {
  symbol: string;
  lastPriceCents: number | null;
  bidCents: number | null; askCents: number | null;
  bidQty: number | null;   askQty: number | null;
  volume: number;          // Σ qty
  notionalCents: number;   // Σ price×qty
  trades: number;
}

export type FromWorker =
  | { type: 'ready' }
  | { type: 'snapshot'; runId: number; seq: number; instruments: InstrumentAccumulatorDto[];
      stats: { batches: number; updates: number; lastBatchMs: number } }
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
  spreadCents: number | null;      // ask − bid
  volume: number;
  vwapCents: number | null;        // notional / volume, unrounded
  imbalance: number | null;        // (bq − aq)/(bq + aq)
}
export function deriveMetrics(a: InstrumentAccumulatorDto): InstrumentMetrics;
```

### 3.6 Main-thread store (`producer.service.ts`)

```ts
@Injectable({ providedIn: 'root' })
export class ProducerService {
  readonly status: Signal<'initializing' | 'running' | 'paused' | 'error'>;
  readonly settings: Signal<ProducerSettings>;
  readonly runId: Signal<number>;
  readonly rows: Signal<InstrumentMetrics[]>;          // computed from latest snapshot
  readonly stats: Signal<{ updatesPerSec: number; batches: number; updates: number }>;
  readonly error: Signal<string | null>;
  pause(): void; resume(): void;
  apply(settings: ProducerSettings): void;            // validates, ++runId, resets rows, sends start
  retry(): void;                                      // only from 'error': recreate worker
}
```
Dependencies injected: `WORKER_FACTORY` (`() => Worker`), `SEED_SOURCE` (`() => [number, number]`), `WASM_URL` (string). Tests replace all three.

---

## 4. Phased implementation

Conventions for every step:
- **Commit per step** (conventional commits, e.g. `feat(wasm): pcg32 rng`), so the history tells the story.
- A step is **done only when all its control checks pass**; checks are commands with an exact expected result (exit code, test name, grep result). No "looks fine".
- **Phase gate** = all step checks + the phase gate command listed at the end of the phase.
- Global gate command (defined in Phase 0, grows over time):
  ```bash
  npm run verify   # = lint:types && test:wasm && test && build
  ```

---

### Phase 0 — Toolchain & repo baseline

**Goal:** reproducible local + CI toolchain; scaffold cleaned; strict settings.

| Step | Work | Control check (deterministic) |
|---|---|---|
| 0.1 | `git checkout main` (repo is on detached HEAD). Add `.nvmrc` to git. | `git branch --show-current` → `main`; `git status --porcelain` has no `??` lines after commit |
| 0.2 | Install rustup locally; add `rust-toolchain.toml` (`channel = "1.xx.0"` pinned stable, `targets = ["wasm32-unknown-unknown"]`, `profile = "minimal"`). | `rustc --version` prints the pinned version; `rustup target list --installed` contains `wasm32-unknown-unknown` |
| 0.3 | `tsconfig.json`: add `"strict": true`, `"noUncheckedIndexedAccess": true`; angular: `strictTemplates: true`. | `npx tsc -p tsconfig.app.json --noEmit` exit 0 |
| 0.4 | Remove placeholder `app.html` content; minimal shell `<router-outlet>`; update `app.spec.ts`. | `npx ng test --watch=false` exit 0 |
| 0.5 | npm scripts: `wasm:build`, `wasm:verify`, `test:wasm`, `test:rust`, `lint:types`, `verify`, `prestart`/`prebuild` → `wasm:build`. `.gitignore`: `/public/wasm/`, `/wasm/producer/target/`. | `npm run` lists all scripts; `git check-ignore public/wasm/x.wasm` exit 0 |
| 0.6 | Prettier check script `format:check`. | `npm run format:check` exit 0 |

**Phase 0 gate:** `npx ng build` exit 0 and `npx ng test --watch=false` exit 0 on a clean clone (`git clean -xdf -e node_modules && npm ci`).

---

### Phase 1 — Wasm producer (Rust)

**Goal:** a deterministic, invariant-preserving market update generator exposed via the raw ABI.

| Step | Work | Control check |
|---|---|---|
| 1.1 | `cargo new --lib wasm/producer`; `crate-type = ["cdylib", "rlib"]` (rlib lets `cargo test` run natively); release profile `opt-level="s"`, `lto=true`, `codegen-units=1`, `panic="abort"`, `strip=true`. | `cargo build --manifest-path wasm/producer/Cargo.toml --release --target wasm32-unknown-unknown` exit 0 |
| 1.2 | `rng.rs`: SplitMix64 + PCG32, `next_u32`, `below(n)` (Lemire unbiased), `unit_f64`. | `cargo test rng::` — tests: (a) same seed ⇒ identical first 1 000 outputs, (b) different seeds differ, (c) `below(7)` over 70 000 draws: every bucket within ±10 % of 10 000 (fixed seed ⇒ deterministic) |
| 1.3 | `model.rs`: `InstrumentState::new(rng)`, `step(&mut self, rng) -> Update` implementing §3.2. | `cargo test model::` — 100 000 steps from fixed seed: `price>0`, `0<bid<ask`, `qty≥1`, `bidQty,askQty ≤ 1000`, `price==bid‖price==ask`; continuity: `|mid_t − mid_{t−1}| ≤ max(1, mid×5/10000)+1` |
| 1.4 | `producer.rs`: `Producer { rng, instruments: Vec<InstrumentState>, buf: Vec<u32> }`, `generate(n)` writes `n×7` words, reuses buffer (`clear` + `reserve`). | `cargo test producer::` — (a) `generate(n).len() == n*7` for n ∈ {1, 2, 100, 1000}; (b) all instrument indices `< count`; (c) with count=3 over 3 000 updates every instrument appears; (d) determinism: two producers same seed ⇒ identical batches; (e) **state retention**: batch₂'s first update for instrument k is continuous with batch₁'s last for k |
| 1.5 | `lib.rs`: ABI functions; null/invalid handling (`count ∉ [1,50]` ⇒ 0; `n ∉ [1,1000]` ⇒ 0; null producer ⇒ 0; `destroy(null)` no-op). | `cargo test abi::` — invalid inputs return null; create/destroy 10 000× without panic |
| 1.6 | `scripts/build-wasm.mjs`: runs cargo, copies to `public/wasm/producer.wasm`. `scripts/verify-wasm.mjs`: `WebAssembly.Module.exports` equals exactly `{memory, abi_version, record_words, producer_create, producer_generate, producer_destroy}`; `abi_version()==1`; size ≤ 64 KB. | `npm run wasm:build && npm run wasm:verify` exit 0, prints `OK exports=6 size=<N>B` |
| 1.7 | `cargo clippy -- -D warnings`, `cargo fmt --check` in `test:rust`. | `npm run test:rust` exit 0 |

**Phase 1 gate:** `npm run test:rust && npm run wasm:build && npm run wasm:verify` exit 0.

---

### Phase 2 — Domain core in TypeScript (no Angular)

**Goal:** pure, framework-free modules for settings, symbols, metrics, formatting, Wasm adapter.

| Step | Work | Control check |
|---|---|---|
| 2.1 | `settings.ts`: `DEFAULT_SETTINGS = {5,100,500}`, `SETTINGS_LIMITS`, `validateSettings(x): {ok:true,value}|{ok:false,errors}` (integers, ranges, finite). `nominalRate(s) = updatesPerBatch*1000/batchIntervalMs`. | `settings.spec.ts`: defaults equal spec; each boundary (0,1,50,51 / 0,1,1000,1001 / 49,50,2000,2001) accepted/rejected correctly; `1.5`, `NaN`, `Infinity`, `'5'` rejected; `nominalRate(default)===200` |
| 2.2 | `symbols.ts`: 50 unique 4-letter uppercase tickers starting `ALFA, BETA`. | spec: length 50, `new Set(list).size===50`, all match `/^[A-Z]{4}$/` |
| 2.3 | `metrics.ts`: `createAccumulators`, `applyBatch`, `deriveMetrics` (§3.5). | `metrics.spec.ts` (all via hand-built `Uint32Array`s): **worked example** — trades (10@10000),(30@10200), bid 10196 ask 10200, bq 600 aq 400 ⇒ last 10200, volume 40, vwap 10150, spread 4, imbalance 0.2 (`toBeCloseTo(0.2, 12)`); **empty** ⇒ all null, volume 0; **zero book** (bq=aq=0) ⇒ imbalance null; **isolation** — updates for instrument 1 don't change instrument 0/2; **book qty never counted in volume**; **each trade once** — same batch applied twice ⇒ volume doubles exactly (no hidden dedupe/double count); **O(instruments)** — accumulator array length unchanged after 10 000 updates; **precision** — notional at 2^53−1 boundary stays exact for integer inputs |
| 2.4 | `formatters.ts`: `formatCents(c|null)` → `Intl.NumberFormat('en-US',{style:'currency',currency:'USD'})` of `c/100`, null → `—`; `formatImbalance` → `+0.20`/`−0.35`/`0.00`/`—`, clamps display to [−1,1]; `formatVolume` → grouped integer. | spec: `formatCents(10150)==='$101.50'`, `formatCents(4)==='$0.04'`, `formatCents(null)==='—'`, `formatImbalance(0.2)==='+0.20'`, `formatImbalance(-1)==='−1.00'`, `formatVolume(0)==='0'`, `formatVolume(1234567)==='1,234,567'` |
| 2.5 | `wasm-generator.ts` (§3.3). Creates fresh `Uint32Array(memory.buffer, ptr, n*7)` after each call; throws `WasmAbiError` on version mismatch, `RangeError` on null pointer. `dispose` idempotent; `generate` after dispose throws. | `wasm-tests/producer.wasm.test.ts` (Node env, real artefact): batch sizes 1/100/1000 → `length===n*7`; invariants on 50 000 updates; fixed seed ⇒ identical output across two factory instances; invalid count throws; ABI mismatch with a stub module throws `WasmAbiError`; `generate` after `dispose` throws |
| 2.6 | Control check that randomness lives in Wasm. | `grep -rnE "Math\.random|crypto\.getRandomValues" src/app/core/producer --include=*.ts | grep -v spec` → only `producer.service.ts` (seed source) |

**Phase 2 gate:** `npx ng test --watch=false` and `npm run test:wasm` exit 0; coverage of `metrics.ts`, `settings.ts`, `formatters.ts` ≥ 95 % lines (`ng test --coverage`).

---

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

| Step | Work | Control check |
|---|---|---|
| 3.1 | `scheduler.ts`: `Scheduler {schedule(ms, fn): Handle; cancel(h)}`, `Clock {now()}`; real impls + `ManualScheduler` test helper (advance(ms) runs due tasks deterministically). | `scheduler.spec.ts`: tasks run in time order; cancel prevents run |
| 3.2 | `producer-engine.ts` core with `FakeGeneratorFactory` (emits deterministic records, counts `create/dispose`). | `producer-engine.spec.ts`: **batch cadence** — after `start` + `advance(500*3)` exactly 4 snapshots (t=0,500,1000,1500); **batch size** passed to `generate` equals `updatesPerBatch` |
| 3.3 | Pause/resume. | spec: **pause stops generation** — after pause, `advance(10_000)` ⇒ 0 new `generate` calls; **no catch-up** — resume then `advance(499)` ⇒ 0 calls, `advance(1)` ⇒ 1 call; **totals preserved** — volume after resume = before + next batch only |
| 3.4 | Run isolation & cleanup. | spec: **start(run2)** disposes run1 generator exactly once (`dispose` count 1) and cancels its timer (no run1 snapshots after); stale `pause{runId:1}` during run 2 ignored; snapshots of run2 start with `seq=0` and zeroed totals; `dispose` command ⇒ generator disposed, no further posts after `advance(∞)` |
| 3.5 | Ordering & errors. | spec: `start` sent before `init` resolves is executed after `ready`; `pause` sent right after `start` (before load resolves) leaves run paused with 0 batches; `loadFactory` rejects ⇒ single `error{phase:'init'}` containing the message; generator throwing ⇒ `error{phase:'runtime'}` and timer cancelled |
| 3.6 | Slow batch handling. | spec with fake clock where `generate` "takes" 700 ms at interval 500 ⇒ next delay `0`, never two ticks at same time, no burst after |
| 3.7 | `producer.worker.ts` adapter + `tsconfig.worker.json` (`lib: ["es2022","webworker"]`) + `"webWorkerTsConfig"` in `angular.json`. | `npx ng build` exit 0 and `ls dist/findev/browser/ | grep -E "^worker-.*\.js$"` returns 1 file; `npx tsc -p tsconfig.worker.json --noEmit` exit 0 |

**Phase 3 gate:** `npx ng test --watch=false` exit 0; total test wall time < 30 s (`time npx ng test --watch=false`) — proves no real-time waits.

---

### Phase 4 — Main-thread store (`ProducerService`)

| Step | Work | Control check |
|---|---|---|
| 4.1 | DI tokens `WORKER_FACTORY`, `SEED_SOURCE`, `WASM_URL` (default `new URL('wasm/producer.wasm', document.baseURI).href`). `FakeWorker` test double records `postMessage` and exposes `emit(msg)`. | type-check passes |
| 4.2 | Bootstrap: `provideAppInitializer(() => inject(ProducerService).boot())` → create worker once, send `init` then `start{runId:1, DEFAULT_SETTINGS}`; rows = empty accumulators for 5 instruments. | `producer.service.spec.ts`: after boot, worker factory called **exactly once**; messages `[init, start(runId=1, defaults)]`; `rows().length===5`, all `lastPriceCents===null`, `volume===0`; `status()==='initializing'` until `ready`+`status running` |
| 4.3 | Snapshot handling with run gate. | spec: snapshot `runId===current` updates rows; **stale snapshot (runId 1 after apply ⇒ runId 2) is dropped** — rows remain zeroed; snapshot with `seq` ≤ last seen ignored |
| 4.4 | `apply(settings)`: `validateSettings` (throws on invalid — UI never calls with invalid), `runId++`, settings signal set, rows reset to `instrumentCount` empty rows **synchronously**, send `start`. Works from paused. | spec: after apply from paused ⇒ last message `start{runId:2}`, `status()` becomes `running` on worker ack; rows length = new count, all empty; stats reset |
| 4.5 | `pause()/resume()`: send with current runId; optimistic `status` update, reconciled by worker `status` messages. | spec: pause ⇒ message `{pause, runId}`; double pause sends once; resume from running is no-op |
| 4.6 | Throughput stat: updates/s computed from snapshot `stats.updates` deltas over a 1 s sliding window using injected `Clock`. | spec with fake clock: 2 snapshots of 100 updates 500 ms apart ⇒ `200` |
| 4.7 | Errors & cleanup: `worker.onerror`, `onmessageerror`, `error` messages ⇒ `status='error'`, `error()` message. `retry()` terminates old worker, creates new one, re-sends init+start with **new** runId. `DestroyRef.onDestroy` ⇒ send `dispose` + `terminate()`. | spec: init error sets human-readable message; `retry` ⇒ factory call count 2, old `terminate` called once; `TestBed.resetTestingModule()` (destroys root injector) ⇒ `terminate` called |
| 4.8 | Navigation invariant. | spec: create router harness, navigate dashboard→settings→dashboard ×5 ⇒ factory call count still 1; status preserved (pause, navigate, still paused) |

**Phase 4 gate:** `npx ng test --watch=false` exit 0; `grep -rn "new Worker" src/app | grep -v spec` → exactly 1 hit (`worker-factory.ts`).

---

### Phase 5 — Dashboard page

| Step | Work | Control check |
|---|---|---|
| 5.1 | `MetricsTableComponent` (`input.required<InstrumentMetrics[]>()`, OnPush): columns Symbol · Last · Spread · Volume · VWAP · Imbalance; `@for (r of rows(); track r.symbol)`; numeric columns right-aligned, `font-variant-numeric: tabular-nums` (no jitter at 20 Hz); imbalance coloured by sign with text sign too (not colour-only). | spec: given worked-example metrics ⇒ cells `$102.00`, `$0.04`, `40`, `$101.50`, `+0.20`; given empty row ⇒ `—`,`—`,`0`,`—`,`—` |
| 5.2 | `ProducerStatusComponent`: status pill (Initializing/Running/Paused/Error), run #, settings summary, nominal vs measured updates/s, batches; Pause/Resume button (label/`aria-pressed` reflect state; disabled while initializing/error). | spec: running ⇒ button text `Pause`; click ⇒ `service.pause()` called; paused ⇒ `Resume`; error ⇒ alert region with message + `Retry` |
| 5.3 | `DashboardPage` composes both, reads signals from `ProducerService`. | spec with stub service: renders N rows for N instruments |
| 5.4 | Accessibility: `<table>` with `<caption>`, `scope="col"`; status in `role="status" aria-live="polite"` (only status text, **not** the live table, to avoid screen-reader flooding). | spec asserts `caption` exists and `role="status"` present |

**Phase 5 gate:** tests pass; `npx ng build` within budgets (initial < 500 kB warning budget).

---

### Phase 6 — Settings page

| Step | Work | Control check |
|---|---|---|
| 6.1 | `integerValidator`: error `{integer:true}` when value non-null and `!Number.isInteger(v)`. | spec: `1`→null, `1.5`→error, `null`→null (required handles it) |
| 6.2 | `SettingsPage`: typed `NonNullableFormBuilder` group, validators `required, integer, min, max` per `SETTINGS_LIMITS`; initial values = `service.settings()`; inputs `type="number" step="1" inputmode="numeric"` with labels, hints showing ranges, errors shown on touched/dirty (`aria-describedby`). Live "Nominal rate: 200 updates/s" from form value. | spec: initial values `5/100/500`; set `0` ⇒ form invalid + error text `Must be between 1 and 50`; set `1.5` ⇒ `Must be a whole number`; Apply button disabled when invalid |
| 6.3 | Editing doesn't affect producer. | spec: change values, don't click Apply ⇒ `service.apply` not called (spy) and `service.settings()` unchanged |
| 6.4 | Apply → `service.apply(form.getRawValue())`, form marked pristine, confirmation "Run #N started with …". "Reset to defaults" fills form only. | spec: Apply with valid values ⇒ `apply` called once with integers `{10,200,250}`; reset-to-defaults ⇒ form values default, `apply` not called |
| 6.5 | Integration (real `ProducerService` + `FakeWorker`): apply ⇒ dashboard rows cleared and stale snapshot rejected. | spec: emit snapshot run1 with volume 40 ⇒ apply ⇒ rows volume 0 ⇒ emit another run1 snapshot ⇒ still 0 ⇒ emit run2 snapshot ⇒ updated |

**Phase 6 gate:** `npx ng test --watch=false` exit 0.

---

### Phase 7 — Shell, routing, error UX

| Step | Work | Control check |
|---|---|---|
| 7.1 | Routes: `''`→`dashboard` redirect, `dashboard`, `settings` (`loadComponent` lazy), `**`→`dashboard`. `withComponentInputBinding()` not needed. Header nav with `routerLinkActive`, status pill visible on both pages. | `app.routes.spec.ts`: navigating to `/unknown` lands on `/dashboard` |
| 7.2 | Global init-error banner (from `service.error()`), with Retry. | spec: service in error ⇒ banner text contains message and Retry triggers `retry()` |
| 7.3 | Minimal responsive styling (table scrolls horizontally on narrow screens, ≥ 44 px touch targets). Keep component styles < 4 kB budget. | `npx ng build` no budget warnings |

**Phase 7 gate:** `npm run verify` exit 0.

---

### Phase 8 — Repository, CI/CD, README

| Step | Work | Control check |
|---|---|---|
| 8.1 | Create GitHub repo (public), push `main` with full history. | `git ls-remote origin main` returns the local `HEAD` SHA |
| 8.2 | `.github/workflows/ci-deploy.yml`: on `push` (all branches) + `pull_request`: checkout → `actions/setup-node` (`node-version-file: .nvmrc`, npm cache) → Rust via `rust-toolchain.toml` (`dtolnay/rust-toolchain` + `Swatinem/rust-cache`) → `npm ci` → `npm run test:rust` → `npm run wasm:build` → `npm run wasm:verify` → `npm run test:wasm` → `npx ng test --watch=false` → `npx ng build --base-href "/${{ github.event.repository.name }}/"` → `cp dist/findev/browser/index.html dist/findev/browser/404.html` → `actions/upload-pages-artifact`. Job `deploy` (`needs: build`, `if: github.ref == 'refs/heads/main'`, `permissions: pages: write, id-token: write`, `concurrency: pages`) → `actions/deploy-pages`. | Workflow run on push is green (`gh run list --limit 1` → `completed success`) |
| 8.3 | Enable Pages "Source: GitHub Actions". | `gh api repos/{owner}/{repo}/pages --jq .build_type` → `workflow` |
| 8.4 | `scripts/smoke-deploy.mjs <url>`: GET `/` 200 and contains `<app-root`; GET `/wasm/producer.wasm` 200 with `content-type: application/wasm`; GET `/settings` (deep link) 200/404-with-app-shell. Run as last CI step after deploy. | CI step exit 0 |
| 8.5 | Auto-deploy proof: push a trivial commit (e.g. version string in footer), wait for workflow, smoke script sees new string. | Live page footer shows new short SHA (inject `GITHUB_SHA` at build via `define` or environment file) |
| 8.6 | README: overview, architecture diagram (Mermaid: Angular ⇄ worker ⇄ Wasm), decisions & trade-offs (summarise §1), prerequisites (Node 24, rustup), commands (`npm ci`, `npm start`, `npm test`, `npm run test:rust`, `npm run test:wasm`, `npm run verify`), live demo + repo links, data model & formulas, known limits (precision note D5, deploy only from `main`). | README contains all commands; each command run copy-paste on clean clone exits 0 |

**Phase 8 gate:** fresh clone in temp dir → follow README verbatim → `npm run verify` exit 0; live URL passes smoke script.

---

### Phase 9 — Hardening, performance & interview readiness

| Step | Work | Control check |
|---|---|---|
| 9.1 | Max-load check: apply `50 / 1000 / 50` (20 000 updates/s). Chrome DevTools Performance 10 s recording. | Main thread: no long tasks > 50 ms attributable to app; measured updates/s within ±10 % of nominal; worker batch time (`stats.lastBatchMs`) < 5 ms |
| 9.2 | Memory: 5-minute run at max load. | Heap snapshot growth < 2 MB after GC (no history retention); `grep -rnE "\.push\(" src/app/core/producer --include=*.ts | grep -v spec` → no push of updates into long-lived arrays |
| 9.3 | Error path manual check: rename wasm URL via DevTools override / block request. | UI shows "Failed to load market data engine (HTTP 404 …)" + Retry works after unblocking |
| 9.4 | Background tab: switch away 30 s, return. | No burst of catch-up batches; totals continue |
| 9.5 | Requirement traceability: every row R1–R24 has a passing test or a documented manual check. | Checklist in README "Requirements coverage" fully ticked |
| 9.6 | Interview extension rehearsal (prove architecture is flexible): e.g. add a 6th metric (trade count), add sorting, add per-instrument price flash. | Each is ≤ 1 file change in the relevant layer; tests still pass |

**Final gate (Definition of Done):**
1. `npm run verify` exit 0 locally and in CI.
2. Live demo loads, shows 5 instruments updating, Pause/Resume works, Apply resets.
3. All R1–R24 traced.
4. Commit history shows phased development (≥ 1 commit per step).

---

## 5. Test inventory (maps to §4 of the task)

| Task requirement | Suite | Key cases |
|---|---|---|
| Metric calculations, worked example, zero denominators, instrument isolation | `metrics.spec.ts`, `formatters.spec.ts`, `metrics-table.component.spec.ts` | worked example exact numbers; empty ⇒ unavailable + volume 0; bq+aq = 0 ⇒ imbalance unavailable; instrument isolation; book qty excluded from volume |
| Settings validation & reset on apply | `settings.spec.ts`, `settings.page.spec.ts`, `producer.service.spec.ts` | boundaries, non-integers, required; editing doesn't apply; apply resets rows/stats and increments runId; apply from paused starts running |
| Pause/resume & stale-run rejection | `producer-engine.spec.ts`, `producer.service.spec.ts` | no generation while paused; no catch-up; totals preserved; stale snapshot / stale command ignored |
| Generator behaviour | Rust `cargo test` + `wasm-tests/producer.wasm.test.ts` | exact batch sizes; invariants on 100k updates; determinism by seed; state continuity across calls; invalid input handling |

All time-dependent tests use `ManualScheduler`/fake `Clock`; all randomness uses fixed seeds. No test sleeps.

---

## 6. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Wasm 404 on GitHub Pages sub-path | High if unhandled | App dead | URL from `document.baseURI` (D4); smoke test checks `/wasm/producer.wasm` |
| Detached `ArrayBuffer` after memory growth | Medium | Wrong/empty reads | Re-create view after every `generate`; Wasm test with growing batch sizes 1→1000 |
| Stale run data leak | Medium | Spec violation | `runId` gate on both sides; dedicated tests (3.4, 4.3, 6.5) |
| Angular 22 / Vitest 5 API drift (worker config, unit-test builder options) | Medium | Build/test friction | Verify each config change with gate commands immediately; keep worker logic outside Angular |
| Rust not installed for reviewers locally | Medium | Can't build | README prerequisites; `prestart` prints clear message if `cargo` missing; CI builds everything |
| Timer throttling in background tabs | Low | Lower throughput while hidden | Accepted; start-to-start scheduling prevents bursts (9.4) |
| Float precision of notional (D5) | Very low | Sub-cent error after ~12 h at max load | Documented; boundary test |

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
feat(core): formatters
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
