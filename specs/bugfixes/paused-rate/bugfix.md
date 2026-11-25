# Bugfix — Measured rate comes back while paused

> Found during market-dashboard task 9.4 · Fixed in `05d0d14` · Requirements: R6, R7

## Current behaviour

1. WHEN the producer is paused while a batch is in flight, and that batch's snapshot arrives after Pause, THEN the status bar shows a non-zero measured updates/s while the status says "Paused".
2. WHEN the Wasm fails to load THEN the init error names the Wasm URL twice.

## Expected behaviour

1. WHILE paused THE SYSTEM SHALL show a measured rate of 0, even when a late snapshot updates the totals.
2. WHEN the producer resumes THE SYSTEM SHALL compute the first rate only from updates generated after resume.
3. IF the Wasm fails to load THEN THE SYSTEM SHALL name the URL once, followed by the HTTP status.

## Unchanged behaviour

- A batch generated before Pause and delivered after it is still **accepted** into the totals (same `runId`, decision in market-dashboard requirements "Open questions").
- Snapshots from another run are still dropped (R12).

## Root cause

`ThroughputMeter` counted every accepted snapshot as new throughput, including the late one after Pause. The loader and the engine both added the URL to the error text.

## Fix

- `ThroughputMeter.sync()` records the snapshot's total without counting it as throughput; the store calls it for snapshots that arrive while paused.
- The loader reports only the HTTP status; the engine's prefix names the URL.

## Tasks

- [x] Regression test: late snapshot after Pause → rate stays 0 (`producer-store-throughput.spec.ts`, `throughput-meter.spec.ts`).
- [x] Fix `ThroughputMeter`, the store and the loader message.
- [x] Control check: `npm run test:ci` and `init-error.e2e.ts` green.
