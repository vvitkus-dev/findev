/** Opaque handle returned by `Scheduler.schedule`. */
export type TimerHandle = number;

/** One-shot timers. The engine reschedules itself after each batch (no `setInterval`). */
export interface Scheduler {
  schedule(delayMs: number, task: () => void): TimerHandle;
  cancel(handle: TimerHandle): void;
}

/** Monotonic milliseconds (e.g. `performance.now()`). */
export interface Clock {
  now(): number;
}
