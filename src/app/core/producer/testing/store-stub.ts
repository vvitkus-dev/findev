import { computed, signal } from '@angular/core';
import type { Provider } from '@angular/core';
import { createAccumulators, deriveMetrics } from '../engine/metrics';
import { DEFAULT_SETTINGS } from '../engine/producer-settings';
import type { ProducerSettings } from '../engine/producer-settings.model';
import { ProducerStore } from '../producer-store';
import type { ProducerStats, ProducerStatus } from '../producer-store.model';

type StoreSurface = Pick<
  ProducerStore,
  'status' | 'settings' | 'runId' | 'stats' | 'error' | 'rows' | 'pause' | 'resume' | 'retry'
>;

/**
 * Stand-in for `ProducerStore` in component tests: same public signals (writable here so tests
 * can set any state) and command methods that only record their calls. No worker, no timing.
 */
export class ProducerStoreStub implements StoreSurface {
  readonly status = signal<ProducerStatus>('running');
  readonly settings = signal<ProducerSettings>(DEFAULT_SETTINGS);
  readonly runId = signal(1);
  readonly stats = signal<ProducerStats>({ updatesPerSec: 0, batches: 0, updates: 0 });
  readonly error = signal<string | null>(null);
  readonly instrumentCount = signal(DEFAULT_SETTINGS.instrumentCount);
  readonly rows = computed(() => createAccumulators(this.instrumentCount()).map(deriveMetrics));
  /** Command names in call order, e.g. `['pause', 'resume']`. */
  readonly calls: string[] = [];

  pause(): void {
    this.calls.push('pause');
  }

  resume(): void {
    this.calls.push('resume');
  }

  retry(): void {
    this.calls.push('retry');
  }
}

/** `{ provide: ProducerStore, useValue: stub }` for `TestBed.configureTestingModule`. */
export const provideStoreStub = (stub: ProducerStoreStub): Provider => ({
  provide: ProducerStore,
  useValue: stub,
});
