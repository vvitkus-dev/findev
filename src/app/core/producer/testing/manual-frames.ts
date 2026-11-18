import type { FrameSource } from '../repaint-pacer.model';

/** Deterministic animation frames for tests: nothing runs until `tick()`. */
export class ManualFrames implements FrameSource {
  private readonly callbacks = new Map<number, (timestamp: number) => void>();
  private nextHandle = 1;

  request(callback: (timestamp: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  /** Callbacks waiting for the next frame. */
  get pending(): number {
    return this.callbacks.size;
  }

  /** Runs one frame at `timestamp`: every callback requested before it. */
  tick(timestamp: number): void {
    const due = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of due) callback(timestamp);
  }

  /** Runs frames at the given timestamps, in order. */
  ticks(timestamps: readonly number[]): void {
    for (const t of timestamps) this.tick(t);
  }
}
