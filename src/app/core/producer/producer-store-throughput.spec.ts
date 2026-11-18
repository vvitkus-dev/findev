import { bootRunning, provideStoreTestbed, snapshot } from './testing/store-harness';
import type { ProducerSettings } from './engine/producer-settings.model';

const NEW_SETTINGS: ProducerSettings = {
  instrumentCount: 8,
  updatesPerBatch: 50,
  batchIntervalMs: 250,
};

describe('ProducerStore — throughput (4.6)', () => {
  it('2 snapshots of 100 updates 500 ms apart ⇒ 200 updates/s', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 0, { updates: 100 }));
    h.clock.advance(500);

    // Act
    h.worker().emit(snapshot(1, 1, { updates: 200 }));

    // Assert
    expect(store.stats().updatesPerSec).toBe(200);
  });

  it('after pause/resume the rate counts only updates generated since resume', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 0, { updates: 100 }));
    store.pause();
    h.clock.advance(100);
    store.resume();
    h.clock.advance(500);

    // Act — cumulative 200: the batch before pause (100) must not be counted again
    h.worker().emit(snapshot(1, 1, { updates: 200 }));

    // Assert
    expect(store.stats().updatesPerSec).toBe(100);
  });

  it('a new run measures from scratch (run 1 totals do not leak into run 2)', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 0, { updates: 1_000 }));
    store.apply(NEW_SETTINGS);
    h.clock.advance(100);

    // Act
    h.worker().emit(snapshot(2, 0, { count: 8, updates: 100 }));

    // Assert
    expect(store.stats().updatesPerSec).toBe(100);
  });

  it('pause drops the measured rate to 0', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 0, { updates: 100 }));

    // Act
    store.pause();

    // Assert
    expect(store.stats()).toEqual({ updatesPerSec: 0, batches: 1, updates: 100 });
  });

  it('a batch that lands after pause counts in the totals but keeps the rate at 0', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 0, { updates: 100 }));
    store.pause();
    h.clock.advance(100);

    // Act
    h.worker().emit(snapshot(1, 1, { updates: 200 }));

    // Assert
    expect(store.stats()).toEqual({ updatesPerSec: 0, batches: 2, updates: 200 });
  });

  it('after resume, a batch that landed while paused is not counted again', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 0, { updates: 100 }));
    store.pause();
    h.worker().emit(snapshot(1, 1, { updates: 200 }));
    store.resume();
    h.clock.advance(500);

    // Act
    h.worker().emit(snapshot(1, 2, { updates: 300 }));

    // Assert — only the 100 updates generated after resume
    expect(store.stats().updatesPerSec).toBe(100);
  });
});
