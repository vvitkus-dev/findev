# Adaptive Repaint — Requirements

> Spec phase 1 of 3 · Next: [design.md](design.md) · [tasks.md](tasks.md)
>
> Refines [market-dashboard R19](../market-dashboard/requirements.md#requirement-6--performance-and-resilience)
> ("the UI stays usable at high rates"). Found during market-dashboard task 9.1.

## Introduction

At maximum load (20 000 updates/s, 250 changing cells per batch) with a 20× CPU slowdown, the main
thread was saturated by layout, commit and paint: 28–48 fps and up to 5 long tasks a second, and
worse with the accessibility tree on. The worker and the store kept up, but repainting every
snapshot did not.

## Requirement 1 — Stay responsive on slow devices

**User story:** As a viewer on a slow device, I want the table to repaint less often when my
device can't keep up, so that the page stays responsive and the numbers stay correct.

**Acceptance criteria**

1. **AR1** WHILE repaints are cheap THE SYSTEM SHALL repaint the table for every snapshot.
2. **AR2** WHEN 3 repaints within one second each make a frame longer than 50 ms THE SYSTEM SHALL repaint at most once every 100 ms, always with the latest snapshot.
3. **AR3** THE SYSTEM SHALL judge only the frames that render a repaint; long frames from anything else (start-up, GC, another tab) SHALL NOT start throttling.
4. **AR4** WHEN every repaint stays under 25 ms for the calm period (3 s) THE SYSTEM SHALL return to full rate; IF throttling starts again soon after THEN THE SYSTEM SHALL double the next calm period, up to 60 s.
5. **AR5** WHILE throttling THE SYSTEM SHALL still process every snapshot (run isolation and measured rate unchanged), so no trade is lost (R18).
6. **AR6** WHILE throttling THE SYSTEM SHALL say so in the table caption without moving the table.

## Requirement 2 — Run and pause semantics stay intact

**User story:** As an operator, I want Apply and Pause to behave exactly as before, so that
throttling never shows stale or delayed data.

**Acceptance criteria**

1. **AR7** WHEN a new run is applied THE SYSTEM SHALL drop a deferred repaint, so the old run is never shown (R12).
2. **AR8** WHEN the producer is paused THE SYSTEM SHALL show the deferred repaint immediately, so a paused table never lags behind.

## Non-goals

- Throttling the worker or skipping batches: generation and accumulation stay at full rate.
- Virtual scrolling: at most 50 rows are shown.

## Traceability

| ID       | Design | Tasks | Verified by                                        |
| -------- | ------ | ----- | -------------------------------------------------- |
| AR1–AR4  | §2, §3 | T1    | `repaint-pacer.spec.ts` with injected frames/clock |
| AR5      | §2     | T2    | `producer-store-pacing.spec.ts`                    |
| AR6      | §2     | T3    | `metrics-table` spec, `layout-stability.e2e.ts`    |
| AR7, AR8 | §3     | T2    | `producer-store-pacing.spec.ts`                    |
| all      | —      | T4    | 20× CPU trace (T4)                                 |
