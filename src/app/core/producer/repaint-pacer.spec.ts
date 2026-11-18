import { ManualScheduler } from './engine/testing/manual-scheduler';
import { PACER_DEFAULTS, RepaintPacer } from './repaint-pacer';
import { ManualFrames } from './testing/manual-frames';

describe('RepaintPacer', () => {
  let clock: ManualScheduler;
  let frames: ManualFrames;
  let published: number[];
  let modes: boolean[];
  let pacer: RepaintPacer<number>;
  let next: number;

  beforeEach(() => {
    clock = new ManualScheduler();
    frames = new ManualFrames();
    published = [];
    modes = [];
    next = 1;
    pacer = new RepaintPacer<number>(
      { clock, scheduler: clock, frames },
      (value) => published.push(value),
      (throttled) => modes.push(throttled),
    );
    pacer.start();
    frames.tick(0);
  });

  /** One animation frame `gap` ms after the previous one (time moves with it). */
  function frame(gap: number): void {
    clock.advance(gap);
    frames.tick(clock.now());
  }

  /** Offers a value, then runs the two frames that render it: 16 ms and `cost` ms. */
  function repaint(cost: number): void {
    pacer.offer(next++);
    frame(16);
    frame(cost);
  }

  /** Smooth 16 ms frames for about `ms`, with nothing to repaint. */
  function idle(ms: number): void {
    for (let t = 0; t < ms; t += 16) frame(16);
  }

  /** Three 60 ms repaints in a row: the device can't keep up. */
  function jank(): void {
    for (let i = 0; i < 3; i++) repaint(60);
  }

  it('publishes every value at once while repaints are fast', () => {
    // Act
    for (let i = 0; i < 10; i++) repaint(16);

    // Assert
    expect(published).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pacer.throttled).toBe(false);
    expect(modes).toEqual([]);
  });

  it('three slow repaints within a second switch to throttled mode', () => {
    // Act
    jank();

    // Assert
    expect(pacer.throttled).toBe(true);
    expect(modes).toEqual([true]);
  });

  it('long frames without repaints (start-up, GC) never throttle', () => {
    // Act
    for (let i = 0; i < 20; i++) frame(80);

    // Assert
    expect(pacer.throttled).toBe(false);
  });

  it('slow repaints only twice a second never throttle (the default rate)', () => {
    // Act
    for (let i = 0; i < 6; i++) {
      repaint(80);
      idle(500);
    }

    // Assert
    expect(pacer.throttled).toBe(false);
  });

  it('a hidden tab (gap over a second) does not make a repaint slow', () => {
    // Act
    for (let i = 0; i < 5; i++) {
      pacer.offer(next++);
      frame(16);
      frame(5_000);
    }

    // Assert
    expect(pacer.throttled).toBe(false);
  });

  it('a repaint on every 60 ms frame (full rate on a slow device) throttles', () => {
    // Act: each repaint lands while the previous one is still being judged.
    for (let i = 0; i < 10; i++) {
      pacer.offer(next++);
      frame(60);
    }

    // Assert
    expect(pacer.throttled).toBe(true);
  });

  it('throttled: publishes at most every 100 ms, always the latest value', () => {
    // Arrange
    jank();
    clock.advance(1_000);
    const before = published.length;

    // Act
    pacer.offer(100);
    clock.advance(50);
    pacer.offer(200);
    pacer.offer(300);
    const atFifty = published.slice(before);
    clock.advance(50);

    // Assert
    expect(atFifty).toEqual([100]);
    expect(published.slice(before)).toEqual([100, 300]);
  });

  it('throttling ends after 3 s of repaints under 25 ms, then publishes at once again', () => {
    // Arrange
    jank();
    for (let i = 0; i < 40; i++) {
      repaint(16);
      idle(64);
    }
    const before = published.length;

    // Act
    pacer.offer(100);
    pacer.offer(200);

    // Assert
    expect(modes).toEqual([true, false]);
    expect(published.slice(before)).toEqual([100, 200]);
  });

  /** Fast (16 ms) repaints every 80 ms for about `ms`. */
  function calm(ms: number): void {
    for (let t = 0; t < ms; t += 96) {
      repaint(16);
      idle(64);
    }
  }

  /** How long throttling lasts once repaints turn fast: jank, then calm until it ends. */
  function throttledFor(): number {
    jank();
    const start = clock.now();
    const changes = modes.length;
    while (modes.length === changes) calm(96);
    return Math.round((clock.now() - start) / 1_000);
  }

  it('backoff: a quick relapse doubles the next calm period, up to 60 s', () => {
    // Act: relapse right after each recovery.
    const periods = Array.from({ length: 7 }, () => throttledFor());

    // Assert
    expect(periods).toEqual([3, 6, 12, 24, 48, 60, 60]);
  });

  it('backoff resets when throttling comes back only after a calm period', () => {
    // Arrange
    throttledFor();
    throttledFor();
    calm(7_000);

    // Act
    const period = throttledFor();

    // Assert
    expect(period).toBe(3);
  });

  it('hysteresis: 40 ms repaints keep throttling on, but never start it', () => {
    // Arrange
    const fresh = new RepaintPacer<number>(
      { clock, scheduler: clock, frames },
      () => undefined,
      () => undefined,
    );
    fresh.start();
    jank();

    // Act
    for (let i = 0; i < 40; i++) {
      repaint(40);
      idle(48);
    }

    // Assert
    expect(modes).toEqual([true]);
    expect(fresh.throttled).toBe(false);
  });

  it('flush() publishes a deferred value at once; drop() forgets it', () => {
    // Arrange
    jank();
    const before = published.length;
    pacer.offer(100);
    pacer.offer(200);
    pacer.flush();
    pacer.offer(300);

    // Act
    pacer.drop();
    clock.advance(1_000);

    // Assert
    expect(published.slice(before)).toEqual([200]);
    expect(clock.pending).toBe(0);
  });

  it('flush() with nothing pending publishes nothing', () => {
    // Act
    pacer.flush();

    // Assert
    expect(published).toEqual([]);
  });

  it('start() is idempotent and stop() cancels the frame watch and any deferred value', () => {
    // Arrange
    pacer.start();
    const watching = frames.pending;
    jank();
    const before = published.length;
    pacer.offer(100);
    pacer.offer(200);

    // Act
    pacer.stop();
    clock.advance(1_000);

    // Assert
    expect(watching).toBe(1);
    expect(frames.pending).toBe(0);
    expect(published.length - before).toBeLessThanOrEqual(1);
    expect(published).not.toContain(200);
  });

  it('defaults: 50 ms slow repaint, 3 per second, 3 s under 25 ms to calm down (backoff to 60 s), 10/s', () => {
    // Act & Assert
    expect(PACER_DEFAULTS).toEqual({
      longFrameMs: 50,
      longFramesToThrottle: 3,
      windowMs: 1_000,
      calmFrameMs: 25,
      calmMs: 3_000,
      maxCalmMs: 60_000,
      throttledIntervalMs: 100,
      maxFrameGapMs: 1_000,
    });
  });
});
