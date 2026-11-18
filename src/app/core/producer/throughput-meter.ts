interface Sample {
  readonly at: number;
  readonly updates: number;
}

/**
 * Measured updates/s over a sliding window: the updates that arrived in the last `windowMs`,
 * scaled to one second. Fed with the cumulative `stats.updates` of each snapshot, so a missed
 * snapshot never loses updates. O(snapshots in window) memory.
 */
export class ThroughputMeter {
  private samples: Sample[] = [];
  private lastTotal = 0;

  constructor(private readonly windowMs = 1_000) {}

  /** Records a snapshot's cumulative update count at time `now` (ms); returns updates/s. */
  record(now: number, totalUpdates: number): number {
    const delta = Math.max(0, totalUpdates - this.lastTotal);
    this.lastTotal = totalUpdates;
    this.samples.push({ at: now, updates: delta });
    return this.rate(now);
  }

  /** Updates/s at time `now`, counting only samples inside the window. */
  rate(now: number): number {
    this.samples = this.samples.filter((s) => s.at > now - this.windowMs);
    const updates = this.samples.reduce((sum, s) => sum + s.updates, 0);
    return Math.round((updates * 1_000) / this.windowMs);
  }

  /**
   * Empties the window but keeps the running total (pause): the run's cumulative count
   * continues after resume, so only updates generated after resume are counted.
   */
  clearWindow(): void {
    this.samples = [];
  }

  /** Forgets everything, including the running total (a new run counts from 0). */
  reset(): void {
    this.samples = [];
    this.lastTotal = 0;
  }
}
