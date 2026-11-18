import { TestBed } from '@angular/core/testing';
import { bootRunning, provideStoreTestbed, snapshot } from './testing/store-harness';
import type { StoreHarness } from './testing/store-harness';
import type { ProducerStore } from './producer-store';

/**
 * Snapshots 0–2 of run 1, each repainted in a 60 ms frame: the device can't keep up, so
 * repaints get limited. Time moves with the frames. Returns the next free `seq`.
 */
function jank(h: StoreHarness): number {
  h.frames.tick(h.clock.now());
  for (let seq = 0; seq < 3; seq++) {
    h.worker().emit(snapshot(1, seq));
    for (const gap of [16, 60]) {
      h.clock.advance(gap);
      h.frames.tick(h.clock.now());
    }
  }
  return 3;
}

describe('ProducerStore — adaptive repaint throttling', () => {
  let h: StoreHarness;
  let store: ProducerStore;

  beforeEach(() => {
    h = provideStoreTestbed();
    store = bootRunning(h);
  });

  it('fast repaints: every snapshot is shown at once', () => {
    // Arrange
    h.frames.tick(0);
    const shown: number[] = [];

    // Act
    for (let seq = 0; seq < 5; seq++) {
      h.worker().emit(snapshot(1, seq));
      shown.push(store.stats().batches);
      h.clock.advance(16);
      h.frames.tick(h.clock.now());
    }

    // Assert
    expect(store.repaintsLimited()).toBe(false);
    expect(shown).toEqual([1, 2, 3, 4, 5]);
  });

  it('a device that cannot keep up gets repaintsLimited', () => {
    // Act
    jank(h);

    // Assert
    expect(store.repaintsLimited()).toBe(true);
  });

  it('limited: snapshots within 100 ms coalesce into one repaint of the latest totals', () => {
    // Arrange
    const seq = jank(h);
    h.clock.advance(100);
    h.worker().emit(snapshot(1, seq));
    h.clock.advance(50);
    h.worker().emit(snapshot(1, seq + 1));
    h.worker().emit(snapshot(1, seq + 2));
    const shownAtFifty = store.stats().batches;

    // Act
    h.clock.advance(50);

    // Assert
    expect(shownAtFifty).toBe(seq + 1);
    expect(store.stats().batches).toBe(seq + 3);
    expect(store.stats().updates).toBe(100 * (seq + 3));
  });

  it('limited: the measured rate still counts every snapshot, shown or not', () => {
    // Arrange
    const seq = jank(h);
    h.clock.advance(1_000);
    h.worker().emit(snapshot(1, seq, { updates: 1_300 }));
    h.clock.advance(50);
    h.worker().emit(snapshot(1, seq + 1, { updates: 2_300 }));

    // Act
    h.clock.advance(50);

    // Assert: after the 300 updates of the jank batches, 1 000 more in each of two snapshots.
    expect(store.stats().updatesPerSec).toBe(2_000);
  });

  it('apply drops a deferred repaint: the old run is never shown again', () => {
    // Arrange
    const seq = jank(h);
    h.worker().emit(snapshot(1, seq));

    // Act
    store.apply({ instrumentCount: 3, updatesPerBatch: 10, batchIntervalMs: 100 });
    h.clock.advance(1_000);

    // Assert
    expect(store.stats().batches).toBe(0);
    expect(store.rows()).toHaveLength(3);
    expect(store.rows().every((r) => r.lastPriceCents === null)).toBe(true);
  });

  it('pause shows a deferred repaint at once, so the paused table is complete', () => {
    // Arrange
    const seq = jank(h);
    h.worker().emit(snapshot(1, seq));
    const shownBefore = store.stats().batches;

    // Act
    store.pause();

    // Assert
    expect(shownBefore).toBe(seq);
    expect(store.stats().batches).toBe(seq + 1);
    expect(store.stats().updatesPerSec).toBe(0);
  });

  it('stops watching animation frames when the app is destroyed', () => {
    // Arrange
    const watching = h.frames.pending;

    // Act
    TestBed.resetTestingModule();

    // Assert
    expect(watching).toBe(1);
    expect(h.frames.pending).toBe(0);
  });
});
