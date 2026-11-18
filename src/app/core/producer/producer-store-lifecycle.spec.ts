import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS } from './engine/producer-settings';
import {
  TEST_SEED,
  TEST_WASM_URL,
  bootRunning,
  provideStoreTestbed,
} from './testing/store-harness';

describe('ProducerStore — errors (4.7)', () => {
  it('turns an init error into a human-readable message and error status', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = h.store();
    store.boot();

    // Act
    h.worker().emit({
      type: 'error',
      runId: null,
      phase: 'init',
      message: `failed to load ${TEST_WASM_URL}: HTTP 404`,
    });

    // Assert
    expect(store.status()).toBe('error');
    expect(store.error()).toBe(
      `Could not load the market producer (failed to load ${TEST_WASM_URL}: HTTP 404).`,
    );
  });

  it('reports a runtime error of the current run and ignores one from an older run', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    store.apply({ ...DEFAULT_SETTINGS, instrumentCount: 2 });
    h.worker().emit({ type: 'error', runId: 1, phase: 'runtime', message: 'old run' });
    const afterStale = store.status();

    // Act
    h.worker().emit({ type: 'error', runId: 2, phase: 'runtime', message: 'unreachable' });

    // Assert
    expect(afterStale).toBe('initializing');
    expect(store.error()).toBe('The market producer stopped: unreachable');
  });

  it('a crashed worker (onerror) or an unreadable message (onmessageerror) is an error', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().crash('boom');
    const crash = store.error();

    // Act
    h.worker().garble();

    // Assert
    expect(crash).toBe('The market producer crashed: boom');
    expect(store.error()).toBe('Could not read a message from the market producer.');
    expect(store.status()).toBe('error');
  });

  it('a late status message cannot hide an error', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().crash('boom');

    // Act
    h.worker().emit({ type: 'status', runId: 1, status: 'running' });

    // Assert
    expect(store.status()).toBe('error');
  });
});

describe('ProducerStore — retry and cleanup (4.7)', () => {
  it('retry terminates the old worker once and starts a new run on a new worker', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    const old = h.worker();
    old.crash('boom');

    // Act
    store.retry();

    // Assert
    expect(h.workers.workers).toHaveLength(2);
    expect(old.terminated).toBe(1);
    expect(h.worker().sent).toEqual([
      { type: 'init', wasmUrl: TEST_WASM_URL },
      { type: 'start', runId: 2, settings: DEFAULT_SETTINGS, seed: TEST_SEED },
    ]);
    expect(store.status()).toBe('initializing');
    expect(store.error()).toBeNull();
  });

  it('retry outside the error state does nothing', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);

    // Act
    store.retry();

    // Assert
    expect(h.workers.workers).toHaveLength(1);
    expect(store.runId()).toBe(1);
  });

  it('messages from a terminated worker are ignored after retry', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    const old = h.worker();
    old.crash('boom');
    store.retry();
    const onmessage = old.onmessage;

    // Act
    h.worker().emit({ type: 'status', runId: 2, status: 'running' });

    // Assert
    expect(onmessage).toBeNull();
    expect(store.status()).toBe('running');
  });

  it('apply from error recreates the worker with the new settings', () => {
    // Arrange
    const h = provideStoreTestbed();
    const store = bootRunning(h);
    h.worker().crash('boom');
    const settings = { ...DEFAULT_SETTINGS, instrumentCount: 3 };

    // Act
    store.apply(settings);

    // Assert
    expect(h.workers.workers).toHaveLength(2);
    expect(h.worker().last).toEqual({ type: 'start', runId: 2, settings, seed: TEST_SEED });
  });

  it('destroying the root injector disposes and terminates the worker', () => {
    // Arrange
    const h = provideStoreTestbed();
    bootRunning(h);
    const worker = h.worker();

    // Act
    TestBed.resetTestingModule();

    // Assert
    expect(worker.last).toEqual({ type: 'dispose' });
    expect(worker.terminated).toBe(1);
  });
});
