import type { FromWorker, ToWorker } from './engine/protocol.model';

/**
 * The part of `Worker` that `ProducerStore` uses, typed with the producer protocol.
 * A real `Worker` satisfies it; tests pass a `FakeWorker`.
 */
export interface WorkerPort {
  postMessage(message: ToWorker): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}

export type WorkerFactory = () => WorkerPort;

/** 64-bit seed as `[lo, hi]` u32 halves. */
export type SeedSource = () => readonly [number, number];
