import type { Clock, Scheduler } from './scheduler.model';

/** `setTimeout`-based scheduler for the worker (works in any global scope). */
export const realScheduler: Scheduler = {
  schedule: (delayMs, task) => setTimeout(task, delayMs),
  cancel: (handle) => {
    clearTimeout(handle);
  },
};

/** Monotonic clock (`performance.now()` is available in windows and workers). */
export const realClock: Clock = {
  now: () => performance.now(),
};
