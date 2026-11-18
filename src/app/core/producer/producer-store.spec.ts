import { DEFAULT_SETTINGS } from './engine/producer-settings';
import type { ProducerSettings } from './engine/producer-settings.model';
import {
  TEST_SEED,
  TEST_WASM_URL,
  bootRunning,
  provideStoreTestbed,
  snapshot,
} from './testing/store-harness';

const NEW_SETTINGS: ProducerSettings = {
  instrumentCount: 8,
  updatesPerBatch: 50,
  batchIntervalMs: 250,
};

describe('ProducerStore — boot (4.2)', () => {
  it('creates exactly one worker and sends init then start(run 1, defaults)', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = h.store();

    // Act
    store.boot();
    store.boot();

    // Assert
    expect(h.workers.workers).toHaveLength(1);
    expect(h.worker().sent).toEqual([
      { type: 'init', wasmUrl: TEST_WASM_URL },
      { type: 'start', runId: 1, settings: DEFAULT_SETTINGS, seed: TEST_SEED },
    ]);
  });

  it('shows 5 empty rows before the first snapshot', () => {
    // Arrange
    const h = provideStoreTestbed();

    // Act
    h.store().boot();

    // Assert
    const rows = h.store().rows();
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.lastPriceCents === null && r.volume === 0)).toBe(true);
  });

  it('stays initializing until ready + status running', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = h.store();
    store.boot();
    const states = [store.status()];

    // Act
    h.worker().emit({ type: 'ready' });
    states.push(store.status());
    h.worker().emit({ type: 'status', runId: 1, status: 'running' });
    states.push(store.status());

    // Assert
    expect(states).toEqual(['initializing', 'initializing', 'running']);
  });
});

describe('ProducerStore — snapshots and run gate (4.3)', () => {
  it('applies a snapshot of the current run to rows and stats', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);

    // Act
    h.worker().emit(snapshot(1, 0));

    // Assert
    const [first] = store.rows();
    expect(first).toEqual({
      symbol: 'ALFA',
      lastPriceCents: 10_000,
      spreadCents: 2,
      volume: 10,
      vwapCents: 10_000,
      imbalance: 0.2,
    });
    expect(store.stats()).toMatchObject({ batches: 1, updates: 100 });
  });

  it('drops a stale snapshot from run 1 after apply started run 2', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    store.apply(NEW_SETTINGS);

    // Act
    h.worker().emit(snapshot(1, 7));

    // Assert
    expect(store.rows()).toHaveLength(8);
    expect(store.rows().every((r) => r.lastPriceCents === null)).toBe(true);
    expect(store.stats().batches).toBe(0);
  });

  it('ignores a snapshot whose seq is not newer than the last one', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 3));

    // Act
    h.worker().emit(snapshot(1, 2, { updates: 9_999 }));
    h.worker().emit(snapshot(1, 3, { updates: 9_999 }));

    // Assert
    expect(store.stats().updates).toBe(400);
  });
});

describe('ProducerStore — apply (4.4)', () => {
  it('accepts run 2 snapshots from seq 0 even after run 1 reached a higher seq', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 7));
    store.apply(NEW_SETTINGS);

    // Act
    h.worker().emit(snapshot(2, 0, { count: 8 }));

    // Assert
    expect(store.rows().every((r) => r.lastPriceCents === 10_000)).toBe(true);
    expect(store.stats().batches).toBe(1);
  });

  it('from paused: sends start(run 2), resets rows and stats synchronously, runs on ack', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().emit(snapshot(1, 0));
    store.pause();

    // Act
    store.apply(NEW_SETTINGS);
    const statusBeforeAck = store.status();
    h.worker().emit({ type: 'status', runId: 2, status: 'running' });

    // Assert
    expect(h.worker().last).toEqual({
      type: 'start',
      runId: 2,
      settings: NEW_SETTINGS,
      seed: TEST_SEED,
    });
    expect(store.runId()).toBe(2);
    expect(store.settings()).toEqual(NEW_SETTINGS);
    expect(store.rows()).toHaveLength(8);
    expect(store.rows().every((r) => r.volume === 0)).toBe(true);
    expect(store.stats()).toEqual({ updatesPerSec: 0, batches: 0, updates: 0 });
    expect(statusBeforeAck).toBe('initializing');
    expect(store.status()).toBe('running');
  });

  it('rejects invalid settings without changing anything', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    const sent = h.worker().sent.length;

    // Act
    const apply = (): void => {
      store.apply({ ...NEW_SETTINGS, batchIntervalMs: 10 });
    };

    // Assert
    expect(apply).toThrow(/batchIntervalMs/);
    expect(h.worker().sent).toHaveLength(sent);
    expect(store.runId()).toBe(1);
  });
});

describe('ProducerStore — pause / resume (4.5)', () => {
  it('pause sends {pause, runId} once and flips status optimistically', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);

    // Act
    store.pause();
    store.pause();

    // Assert
    expect(h.worker().sent.filter((m) => m.type === 'pause')).toEqual([
      { type: 'pause', runId: 1 },
    ]);
    expect(store.status()).toBe('paused');
  });

  it('resume while running is a no-op; resume after pause sends {resume, runId}', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    store.resume();
    store.pause();

    // Act
    store.resume();

    // Assert
    expect(h.worker().sent.filter((m) => m.type === 'resume')).toEqual([
      { type: 'resume', runId: 1 },
    ]);
    expect(store.status()).toBe('running');
  });

  it('pause while initializing is a no-op', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = h.store();
    store.boot();

    // Act
    store.pause();

    // Assert
    expect(h.worker().sent.map((m) => m.type)).toEqual(['init', 'start']);
    expect(store.status()).toBe('initializing');
  });

  it('ignores status messages of an older run', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    store.apply(NEW_SETTINGS);

    // Act
    h.worker().emit({ type: 'status', runId: 1, status: 'paused' });

    // Assert
    expect(store.status()).toBe('initializing');
  });
});
