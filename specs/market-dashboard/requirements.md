# Market Dashboard — Requirements

> Spec phase 1 of 3 · Next: [design.md](design.md) · [tasks.md](tasks.md)
>
> Source: the take-home task brief (§1 Dashboard, §2 Settings, §3 Producer, §4 Tests, §5 Delivery).
> Every acceptance criterion keeps its original ID (R1–R24), so tests, the README and the
> traceability table below all point at the same IDs.

## Introduction

A realtime fintech dashboard. An Angular app has two pages: a live market **Dashboard** and
producer **Settings**. Simulated market updates come from a **Wasm library written in Rust**,
which runs inside a **Web Worker**. The app must stay correct (every trade counted once, no data
from an old run) and responsive at up to 20 000 updates per second.

**Roles:** _Viewer_ watches the market; _Operator_ configures and controls the producer;
_Reviewer_ builds, tests and judges the repository.

---

## Requirement 1 — Live market table

**User story:** As a viewer, I want one live row per instrument with its key metrics, so that I
can follow the market at a glance.

**Acceptance criteria**

1. **R1** THE SYSTEM SHALL provide two pages, Dashboard and Settings, with navigation between them.
2. **R2** THE SYSTEM SHALL show one table row per instrument with five metrics: last price, spread, volume, VWAP and imbalance.
3. **R3** WHEN a trade is generated THE SYSTEM SHALL add it exactly once to that instrument's volume and VWAP, cumulative since the run started; book quantities SHALL NOT contribute to volume.
4. **R4** WHILE an instrument has no data THE SYSTEM SHALL show its values as unavailable and its volume as 0; IF a metric's denominator is zero THEN THE SYSTEM SHALL show that metric as unavailable.
5. **R5** THE SYSTEM SHALL format prices as currency and imbalance as a number in [−1, +1].
6. **R17** THE SYSTEM SHALL keep prices as integer cents end to end and round only for display.
7. **R18** THE SYSTEM SHALL NOT keep the event history; the UI MAY refresh slower than production, but every trade SHALL be counted.

## Requirement 2 — Producer control

**User story:** As an operator, I want to pause and resume the producer and see its status, so
that I can freeze the market and know what it is doing.

**Acceptance criteria**

1. **R6** WHEN the operator pauses THE SYSTEM SHALL stop generating; WHEN the operator resumes THE SYSTEM SHALL continue with the totals kept and generate no data for the paused interval (no catch-up).
2. **R7** THE SYSTEM SHALL show the producer status.
3. **R10** WHEN the app starts THE SYSTEM SHALL run the producer with the default settings.

## Requirement 3 — Producer settings

**User story:** As an operator, I want to change the number of instruments, the batch size and the
interval, so that I can explore different market loads.

**Acceptance criteria**

1. **R8** THE SYSTEM SHALL offer a form with three integer fields, defaults 5 / 100 / 500 and ranges 1–50 / 1–1000 / 50–2000.
2. **R9** WHILE the operator edits the form THE SYSTEM SHALL NOT change the producer; WHEN the operator applies valid settings THE SYSTEM SHALL start a new run, clear all values and totals, and run even if it was paused.

## Requirement 4 — Run isolation and navigation

**User story:** As a viewer, I want navigation and new runs never to mix or lose data, so that the
numbers I see always belong to the current run.

**Acceptance criteria**

1. **R11** WHEN the user navigates between pages THE SYSTEM SHALL keep the current run and its running/paused state, and SHALL NOT create another producer.
2. **R12** IF a result from a previous run arrives THEN THE SYSTEM SHALL discard it and SHALL NOT overwrite the new run's state.

## Requirement 5 — Simulated market data in Wasm

**User story:** As a reviewer, I want the market simulation to be a real Wasm library running off
the main thread, so that the task's architecture is met, not imitated.

**Acceptance criteria**

1. **R13** THE SYSTEM SHALL generate market updates (a trade plus a bid/ask snapshot) in Wasm, with all randomness and price logic inside Wasm.
2. **R14** THE SYSTEM SHALL keep per-instrument state in the generator, return batches of exactly the requested size, and evolve prices from their previous values.
3. **R15** THE SYSTEM SHALL keep these invariants for every update: price > 0, bid < ask, trade quantity > 0, book quantities ≥ 0, trade price ∈ {bid, ask}.
4. **R16** THE SYSTEM SHALL run the Wasm module inside a Web Worker.

## Requirement 6 — Performance and resilience

**User story:** As a viewer, I want the app to stay usable at maximum load and to explain
failures, so that I can trust it under stress.

**Acceptance criteria**

1. **R19** WHILE the producer runs at its maximum rate (1000 updates every 50 ms = 20 000 updates/s) THE SYSTEM SHALL stay usable. Refined by [adaptive-repaint](../adaptive-repaint/requirements.md).
2. **R20** IF the producer fails to initialise THEN THE SYSTEM SHALL show a meaningful error; WHEN a run is replaced or the app is destroyed THE SYSTEM SHALL release the producer's resources.

## Requirement 7 — Testability

**User story:** As a reviewer, I want fast deterministic tests of the core logic, so that I can
change the code safely.

**Acceptance criteria**

1. **R21** THE SYSTEM SHALL have unit tests for metrics, settings and reset, pause/resume with stale-run rejection, and the generator.
2. **R22** THE SYSTEM's tests SHALL use fixed inputs and controllable dependencies, and SHALL NOT wait on real time.

Quality thresholds for all tests are specified in [quality-gates](../quality-gates/requirements.md).

## Requirement 8 — Delivery

**User story:** As a reviewer, I want a public repository with a live demo, so that I can run,
read and try the work.

**Acceptance criteria**

1. **R23** THE SYSTEM SHALL live in a public GitHub repository with a README (build, run, test) and an incremental commit history.
2. **R24** WHEN a commit is pushed THE SYSTEM SHALL build automatically, and WHEN it is pushed to `main` THE SYSTEM SHALL redeploy the live demo.

---

## Derived requirements

- **D1 — Run identity.** "Results from a previous run must not overwrite the new run's state" ⇒ every message carries a monotonically increasing `runId`; both worker and main thread discard mismatched messages.
- **D2 — Deterministic generator.** Tests need fixed inputs ⇒ generator takes an explicit 64-bit seed. Production seeds come from `crypto.getRandomValues` (entropy source only; all random _draws_ happen in Wasm).
- **D3 — Controllable time.** "No long real-time waits" ⇒ the worker-side engine never calls `setTimeout` directly; it uses an injected `Scheduler` + `Clock`.
- **D4 — Base-href-safe Wasm URL.** GitHub Pages serves under `/<repo>/` ⇒ the Wasm URL is resolved from `document.baseURI` on the main thread and passed to the worker.
- **D5 — Number precision.** `Σ(price×qty)` in cents stays an exact integer in `float64` while `< 2^53 ≈ 9.0e15`. Worst case per instrument (1 instrument, 20 000 updates/s, price ≈ 1e5 cents, qty ≤ 100) ≈ 2e11 cents/s ⇒ exact for ~12.5 h; beyond that relative error ≈ 1e-16, invisible after rounding to cents. Decision: plain `number`, documented, with a unit test at the boundary. (BigInt rejected: 10–50× slower in the hot loop, no visible benefit.)
- **D6 — Status model.** `initializing → running ⇄ paused`, any → `error`. Shown on dashboard with run number and measured throughput.
- **D7 — Scheduling semantics.** "Requested time between batches" ⇒ start-to-start interval; if a batch takes longer than the interval, the next one starts immediately but never _bursts_ to catch up.

## Open questions and decisions

| Ambiguity                                                         | Decision                                                                                           | Rationale                                                                                                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Is a batch generated _before_ pause but delivered after it valid? | **Accept** it (same `runId`).                                                                      | Those trades were generated in the current run; dropping them would violate "every generated trade must contribute". Pause stops _generation_, not delivery of what was already generated. |
| Should Apply navigate to dashboard?                               | Stay on Settings, show "Run #N started" confirmation.                                              | Least surprise; user may tweak further. Interviewer can change in 1 line.                                                                                                                  |
| Settings form when re-visited                                     | Shows the **active (applied)** settings; unsaved drafts are discarded on navigation.               | Form must reflect producer truth; persisting drafts is not required.                                                                                                                       |
| Symbols for 50 instruments                                        | Fixed, deterministic list of 50 four-letter tickers (`ALFA, BETA, GAMA, DLTA, …`) mapped by index. | Wasm only emits `u32` instrument index; no strings cross the boundary.                                                                                                                     |
| "Each push must redeploy"                                         | Deploy on every push to `main`; other branches run build+test only.                                | Interview changes go to `main`; avoids racing deployments from branches to one Pages site. Documented in README.                                                                           |

---

---

## Traceability

| ID  | Design                 | Tasks         | Verified by                                                                |
| --- | ---------------------- | ------------- | -------------------------------------------------------------------------- |
| R1  | §2                     | 5.3, 6.2, 7.1 | component tests, `navigation.e2e.ts`                                       |
| R2  | §1.4, §3.5             | 2.3, 5.1      | `metrics.spec.ts`, `metrics-table.spec.ts`                                 |
| R3  | §1.4, §3.5             | 2.3, 3.2      | `metrics.spec.ts`                                                          |
| R4  | §3.5                   | 2.3, 2.4, 5.1 | `metrics.spec.ts`, `market-format.spec.ts`                                 |
| R5  | §3.5                   | 2.4           | `market-format.spec.ts`                                                    |
| R6  | §1.6, §4.3             | 3.3, 4.5      | `producer-engine.spec.ts`, `producer-store.spec.ts`, `pause-resume.e2e.ts` |
| R7  | §3.6                   | 5.2           | `producer-status.spec.ts`                                                  |
| R8  | §1.8                   | 2.1, 6.1, 6.2 | `producer-settings.spec.ts`, `settings-schema.spec.ts`, `settings.spec.ts` |
| R9  | §1.8, §4.2             | 4.4, 6.3, 6.4 | `settings.spec.ts`, `producer-store.spec.ts`, `settings.e2e.ts`            |
| R10 | §3.6, §4.1             | 4.2           | `producer-store.spec.ts`                                                   |
| R11 | §1.5, §1.7             | 4.8, 7.1      | `producer-store.spec.ts` (worker factory call count), `navigation.e2e.ts`  |
| R12 | §1.5, §3.4, §4.2       | 3.4, 4.3, 6.5 | `producer-store.spec.ts`, `producer-engine.spec.ts`                        |
| R13 | §1.1, §3.2             | 1.2–1.4, 2.6  | Rust tests; `Math.random` ban (lint)                                       |
| R14 | §3.1, §3.2             | 1.3, 1.4      | Rust tests, `wasm-tests/producer.wasm.test.ts`                             |
| R15 | §3.2                   | 1.3           | Rust property-style tests, `wasm-tests/producer.wasm.test.ts`              |
| R16 | §1.5                   | 3.7           | build artefact; `engine/` framework-free lint rule                         |
| R17 | §1.4                   | 2.3, 2.4      | `metrics.spec.ts`, `market-format.spec.ts`                                 |
| R18 | §1.4                   | 2.3, 9.2      | `metrics.spec.ts` (O(instruments) state), memory check 9.2                 |
| R19 | §1.7, adaptive-repaint | 9.1           | performance check 9.1, `repaint-pacer.spec.ts`                             |
| R20 | §5                     | 3.5, 4.7, 7.2 | `producer-engine.spec.ts`, `producer-store.spec.ts`, `init-error.e2e.ts`   |
| R21 | §6                     | Phases 1–6    | the suites above                                                           |
| R22 | §1.6, §6               | 3.1           | `ManualScheduler`, seeded RNG, `FakeWorker`; no-sleep rule                 |
| R23 | §1.9                   | 8.1, 8.6      | public repo, README                                                        |
| R24 | §1.9                   | 8.2–8.5       | CI workflow, `smoke-deploy.mjs`                                            |
