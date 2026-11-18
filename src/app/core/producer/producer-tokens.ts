import { DOCUMENT, InjectionToken, inject } from '@angular/core';
import { realClock } from './engine/scheduler';
import type { Clock } from './engine/scheduler.model';
import type { SeedSource, WorkerFactory } from './producer-tokens.model';

/**
 * Creates the producer Web Worker. This default is the only Worker construction in the app
 * (lint-enforced); tests provide `{ provide: WORKER_FACTORY, useValue: () => fakeWorker }`.
 */
export const WORKER_FACTORY = new InjectionToken<WorkerFactory>('producer.workerFactory', {
  factory: () => () =>
    new Worker(new URL('./engine/producer.worker', import.meta.url), { type: 'module' }),
});

/** Fresh 64-bit seed per run. The only randomness on the TS side (prices are generated in Rust). */
export const SEED_SOURCE = new InjectionToken<SeedSource>('producer.seedSource', {
  factory: () => () => {
    const [lo = 0, hi = 0] = crypto.getRandomValues(new Uint32Array(2));
    return [lo, hi];
  },
});

/** Absolute Wasm URL, resolved against `<base href>` so it works under the `/findev/` sub-path. */
export const WASM_URL = new InjectionToken<string>('producer.wasmUrl', {
  factory: () => new URL('wasm/producer.wasm', inject(DOCUMENT).baseURI).href,
});

/** Monotonic clock for the throughput meter; tests use `ManualScheduler`. */
export const PRODUCER_CLOCK = new InjectionToken<Clock>('producer.clock', {
  factory: () => realClock,
});
