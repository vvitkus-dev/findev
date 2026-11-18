import type { TimerHandle } from './engine/scheduler.model';
import type { PacerDeps, PacerOptions } from './repaint-pacer.model';

export const PACER_DEFAULTS: PacerOptions = {
  longFrameMs: 50,
  longFramesToThrottle: 3,
  windowMs: 1_000,
  calmFrameMs: 25,
  calmMs: 3_000,
  maxCalmMs: 60_000,
  throttledIntervalMs: 100,
  maxFrameGapMs: 1_000,
};

/** Frames watched after a repaint: the one that runs it, and the one that shows its cost. */
const FRAMES_PER_REPAINT = 2;

/**
 * Adaptive repaint throttling for the live table. Normally every offered value is published at
 * once. When the device can't keep up (repaints that make long animation frames), it switches
 * to throttled mode: at most one publish per `throttledIntervalMs`, always the latest value, so
 * the intermediate ones are skipped. Values are cumulative snapshots, so skipping loses no
 * data, only intermediate repaints. Throttling ends once every repaint stays under
 * `calmFrameMs` for the calm period (`calmMs`, doubled after each quick relapse, see
 * `maxCalmMs`).
 *
 * Only repaints are judged: a repaint's cost is the longest of the next `FRAMES_PER_REPAINT`
 * frame gaps, counted once per repaint. Long frames from anything else (start-up, GC, another
 * tab's work) never throttle, and neither do slow repaints that come less than
 * `longFramesToThrottle` times a second.
 *
 * Framework-free: animation frames, timers and time come from `deps`.
 */
export class RepaintPacer<T> {
  private pending: { readonly value: T } | null = null;
  private timer: TimerHandle | null = null;
  private frameHandle: number | null = null;
  private lastFrameAt: number | null = null;
  private longFrames: number[] = [];
  /** Frames left to watch for the current repaint (0: none in flight), and its worst gap. */
  private watchFrames = 0;
  private watchWorstGap = 0;
  private lastSlowFrameAt = Number.NEGATIVE_INFINITY;
  private lastPublishAt = Number.NEGATIVE_INFINITY;
  private throttledMode = false;
  private lastCalmAt = Number.NEGATIVE_INFINITY;
  /** The current calm period: `calmMs`, doubled on each quick relapse. */
  private calmPeriodMs: number | null = null;

  constructor(
    private readonly deps: PacerDeps,
    private readonly publish: (value: T) => void,
    private readonly onModeChange: (throttled: boolean) => void,
    private readonly options: PacerOptions = PACER_DEFAULTS,
  ) {}

  get throttled(): boolean {
    return this.throttledMode;
  }

  /** Starts watching animation frames. Idempotent. */
  start(): void {
    this.frameHandle ??= this.deps.frames.request(this.onFrame);
  }

  /** Stops watching frames and forgets any pending value. */
  stop(): void {
    if (this.frameHandle !== null) this.deps.frames.cancel(this.frameHandle);
    this.frameHandle = null;
    this.drop();
  }

  /** Publishes `value` now, or (throttled) keeps it as the latest and publishes it on time. */
  offer(value: T): void {
    this.pending = { value };
    if (this.timer !== null) return;
    const wait = this.throttledMode
      ? this.lastPublishAt + this.options.throttledIntervalMs - this.deps.clock.now()
      : 0;
    if (wait <= 0) {
      this.flush();
      return;
    }
    this.timer = this.deps.scheduler.schedule(wait, () => {
      this.timer = null;
      this.flush();
    });
  }

  /** Publishes the pending value now (if any). */
  flush(): void {
    this.cancelTimer();
    const pending = this.pending;
    if (pending === null) return;
    this.pending = null;
    this.lastPublishAt = this.deps.clock.now();
    // A repaint that lands while one is being watched is judged together with it.
    if (this.watchFrames === 0) {
      this.watchFrames = FRAMES_PER_REPAINT;
      this.watchWorstGap = 0;
    }
    this.publish(pending.value);
  }

  /** Forgets the pending value without publishing it (a new run starts). */
  drop(): void {
    this.cancelTimer();
    this.pending = null;
  }

  private readonly onFrame = (timestamp: number): void => {
    this.frameHandle = this.deps.frames.request(this.onFrame);
    const gap = this.lastFrameAt === null ? 0 : timestamp - this.lastFrameAt;
    this.lastFrameAt = timestamp;
    if (this.watchFrames > 0) {
      if (gap <= this.options.maxFrameGapMs) this.watchWorstGap = Math.max(this.watchWorstGap, gap);
      this.watchFrames--;
      if (this.watchFrames === 0) this.judgeRepaint(timestamp, this.watchWorstGap);
    }
    this.longFrames = this.longFrames.filter((at) => at > timestamp - this.options.windowMs);
    this.updateMode(timestamp);
  };

  private judgeRepaint(at: number, cost: number): void {
    if (cost >= this.options.calmFrameMs) this.lastSlowFrameAt = at;
    if (cost >= this.options.longFrameMs) this.longFrames.push(at);
  }

  private updateMode(now: number): void {
    const calmPeriod = this.calmPeriodMs ?? this.options.calmMs;
    const throttled = this.throttledMode
      ? now - this.lastSlowFrameAt < calmPeriod
      : this.longFrames.length >= this.options.longFramesToThrottle;
    if (throttled === this.throttledMode) return;
    if (!throttled) this.lastCalmAt = now;
    else if (now - this.lastCalmAt < calmPeriod) {
      this.calmPeriodMs = Math.min(calmPeriod * 2, this.options.maxCalmMs);
    } else this.calmPeriodMs = this.options.calmMs;
    this.throttledMode = throttled;
    this.onModeChange(throttled);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.deps.scheduler.cancel(this.timer);
    this.timer = null;
  }
}
