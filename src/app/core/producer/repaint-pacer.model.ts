import type { Clock, Scheduler } from './engine/scheduler.model';

/** Animation-frame callbacks (`requestAnimationFrame`); tests use `ManualFrames`. */
export interface FrameSource {
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

/** When the pacer limits repaints, and how much. All times in ms. */
export interface PacerOptions {
  /** A repaint whose frame is at least this long is janky (2 dropped frames at 60 Hz). */
  readonly longFrameMs: number;
  /** This many janky repaints within `windowMs` switch to throttled mode. */
  readonly longFramesToThrottle: number;
  readonly windowMs: number;
  /**
   * Throttled mode ends after `calmMs` without a repaint frame of at least `calmFrameMs` (25 ms: any
   * dropped frame at 60 Hz, which measures 33 ms; frame times come in 16.7 ms steps). Lower than
   * `longFrameMs` (hysteresis): a device that only just copes at 10 repaints/s must not flip
   * back to full rate and straight into jank again.
   */
  readonly calmFrameMs: number;
  readonly calmMs: number;
  /**
   * Backoff: throttling that comes back within the current calm period (a device that copes at
   * 10/s but not at full rate) doubles the next calm period, up to this cap.
   */
  readonly maxCalmMs: number;
  /** While throttled, at most one repaint per interval (10 per second). */
  readonly throttledIntervalMs: number;
  /** A longer gap is a hidden tab or a frozen page, not jank: it is not counted. */
  readonly maxFrameGapMs: number;
}

export interface PacerDeps {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly frames: FrameSource;
}
