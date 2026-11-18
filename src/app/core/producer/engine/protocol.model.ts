import type { ProducerSettings } from './producer-settings.model';

/**
 * Raw per-instrument sums kept by the worker (O(instruments), no event history).
 * Plain data so it survives `postMessage` structured cloning. Prices are integer cents.
 */
export interface InstrumentAccumulatorDto {
  symbol: string;
  lastPriceCents: number | null;
  bidCents: number | null;
  askCents: number | null;
  bidQty: number | null;
  askQty: number | null;
  /** Σ trade qty (book quantities are never counted). */
  volume: number;
  /** Σ price × qty in cents; exact while ≤ Number.MAX_SAFE_INTEGER. */
  notionalCents: number;
  trades: number;
}

/** Commands from the main thread. Every run-scoped command carries the `runId` it targets. */
export type ToWorker =
  | { readonly type: 'init'; readonly wasmUrl: string }
  | {
      readonly type: 'start';
      readonly runId: number;
      readonly settings: ProducerSettings;
      /** `[lo, hi]` u32 halves of the 64-bit seed (from `crypto.getRandomValues`). */
      readonly seed: readonly [number, number];
    }
  | { readonly type: 'pause'; readonly runId: number }
  | { readonly type: 'resume'; readonly runId: number }
  | { readonly type: 'dispose' };

interface BatchStats {
  /** Batches generated in this run. */
  readonly batches: number;
  /** Updates generated in this run. */
  readonly updates: number;
  /** Wall time of the last generate + apply, in ms. */
  readonly lastBatchMs: number;
}

type RunStatus = 'running' | 'paused';

/** Events from the worker. The main thread drops any whose `runId` is not the current run. */
export type FromWorker =
  | { readonly type: 'ready' }
  | {
      readonly type: 'snapshot';
      readonly runId: number;
      /** 0 for the first snapshot of a run, +1 per batch. */
      readonly seq: number;
      readonly instruments: InstrumentAccumulatorDto[];
      readonly stats: BatchStats;
    }
  | { readonly type: 'status'; readonly runId: number; readonly status: RunStatus }
  | {
      readonly type: 'error';
      readonly runId: number | null;
      readonly phase: 'init' | 'runtime';
      readonly message: string;
    };
