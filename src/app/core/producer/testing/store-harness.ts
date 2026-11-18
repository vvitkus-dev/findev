import { TestBed } from '@angular/core/testing';
import { createAccumulators } from '../engine/metrics';
import type { FromWorker } from '../engine/protocol.model';
import { ManualScheduler } from '../engine/testing/manual-scheduler';
import { ProducerStore } from '../producer-store';
import { PRODUCER_CLOCK, SEED_SOURCE, WASM_URL, WORKER_FACTORY } from '../producer-tokens';
import { FakeWorkerFactory } from './fake-worker';
import type { FakeWorker } from './fake-worker';

export const TEST_WASM_URL = 'https://example.test/findev/wasm/producer.wasm';
export const TEST_SEED = [7, 0] as const;

type Snapshot = Extract<FromWorker, { type: 'snapshot' }>;

export interface StoreHarness {
  readonly workers: FakeWorkerFactory;
  readonly clock: ManualScheduler;
  /** Injects the store (the first injection constructs it). */
  store(): ProducerStore;
  /** The most recently created fake worker. */
  worker(): FakeWorker;
}

/** Fake worker, fixed seed, fixed Wasm URL and virtual clock for every producer token. */
export function provideStoreTestbed(): StoreHarness {
  const workers = new FakeWorkerFactory();
  const clock = new ManualScheduler();
  TestBed.configureTestingModule({
    providers: [
      { provide: WORKER_FACTORY, useValue: workers.create },
      { provide: SEED_SOURCE, useValue: () => TEST_SEED },
      { provide: WASM_URL, useValue: TEST_WASM_URL },
      { provide: PRODUCER_CLOCK, useValue: clock },
    ],
  });
  return {
    workers,
    clock,
    store: () => TestBed.inject(ProducerStore),
    worker: () => workers.current,
  };
}

/** Boots and plays the worker's acknowledgements, leaving run 1 `running`. */
export function bootRunning(h: StoreHarness): ProducerStore {
  const store = h.store();
  store.boot();
  h.worker().emit({ type: 'ready' });
  h.worker().emit({ type: 'status', runId: store.runId(), status: 'running' });
  return store;
}

/** A snapshot where every instrument traded 10 @ 100.00 with a 100.00 / 100.02 book. */
export function snapshot(
  runId: number,
  seq: number,
  { count = 5, updates = 100 * (seq + 1) }: { count?: number; updates?: number } = {},
): Snapshot {
  const instruments = createAccumulators(count).map((a) => ({
    ...a,
    lastPriceCents: 10_000,
    bidCents: 10_000,
    askCents: 10_002,
    bidQty: 600,
    askQty: 400,
    volume: 10,
    notionalCents: 100_000,
    trades: 1,
  }));
  return {
    type: 'snapshot',
    runId,
    seq,
    instruments,
    stats: { batches: seq + 1, updates, lastBatchMs: 0 },
  };
}
