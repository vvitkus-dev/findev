import type { Clock, Scheduler, TimerHandle } from '../scheduler.model';

interface Task {
  readonly handle: TimerHandle;
  readonly due: number;
  readonly run: () => void;
}

/** Guard against a task that keeps rescheduling itself with a 0 ms delay. */
const MAX_TASKS_PER_ADVANCE = 100_000;

/**
 * Deterministic virtual time for tests: implements both `Scheduler` and `Clock`.
 * Nothing runs until `advance()`; tasks run in due-time order (ties: scheduling order),
 * and `now()` equals the running task's due time. No real waiting ever happens.
 */
export class ManualScheduler implements Scheduler, Clock {
  private time = 0;
  private nextHandle = 1;
  private tasks: Task[] = [];

  now(): number {
    return this.time;
  }

  schedule(delayMs: number, task: () => void): TimerHandle {
    const handle = this.nextHandle++;
    this.tasks.push({ handle, due: this.time + Math.max(0, delayMs), run: task });
    return handle;
  }

  cancel(handle: TimerHandle): void {
    this.tasks = this.tasks.filter((t) => t.handle !== handle);
  }

  /** Number of tasks waiting to run. */
  get pending(): number {
    return this.tasks.length;
  }

  /** Moves time forward by `ms`, running every task that falls due, including newly scheduled ones. */
  advance(ms: number): void {
    const target = this.time + ms;
    for (let ran = 0; ; ran++) {
      const next = this.takeNextDue(target);
      if (next === undefined) break;
      if (ran >= MAX_TASKS_PER_ADVANCE) throw new Error('ManualScheduler: runaway task loop');
      this.time = next.due;
      next.run();
    }
    this.time = Math.max(this.time, target);
  }

  /** Moves the clock without running tasks — simulates work that takes time inside a task. */
  elapse(ms: number): void {
    this.time += ms;
  }

  private takeNextDue(target: number): Task | undefined {
    let best: Task | undefined;
    for (const t of this.tasks) {
      if (t.due <= target && (best === undefined || t.due < best.due)) best = t;
    }
    if (best !== undefined) this.tasks = this.tasks.filter((t) => t !== best);
    return best;
  }
}
