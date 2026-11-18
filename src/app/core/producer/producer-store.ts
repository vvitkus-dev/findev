import { DestroyRef, Service, computed, inject, signal } from '@angular/core';
import { createAccumulators, deriveMetrics } from './engine/metrics';
import { DEFAULT_SETTINGS, validateSettings } from './engine/producer-settings';
import type { ProducerSettings } from './engine/producer-settings.model';
import type { FromWorker, InstrumentAccumulatorDto, ToWorker } from './engine/protocol.model';
import type { ProducerStats, ProducerStatus } from './producer-store.model';
import {
  FRAME_SOURCE,
  PRODUCER_CLOCK,
  PRODUCER_SCHEDULER,
  SEED_SOURCE,
  WASM_URL,
  WORKER_FACTORY,
} from './producer-tokens';
import type { WorkerPort } from './producer-tokens.model';
import { RepaintPacer } from './repaint-pacer';
import { ThroughputMeter } from './throughput-meter';

type Snapshot = Extract<FromWorker, { type: 'snapshot' }>;
type WorkerError = Extract<FromWorker, { type: 'error' }>;

/** What one repaint of the dashboard shows. */
interface DisplayState {
  readonly instruments: readonly InstrumentAccumulatorDto[];
  readonly stats: ProducerStats;
}

const EMPTY_STATS: ProducerStats = { updatesPerSec: 0, batches: 0, updates: 0 };

const describeError = (m: WorkerError): string =>
  m.phase === 'init'
    ? `Could not load the market producer (${m.message}).`
    : `The market producer stopped: ${m.message}`;

/**
 * Main-thread state for the producer: owns the single Web Worker (created in `boot()`, ended
 * when the root injector is destroyed) and exposes read-only signals for the pages.
 *
 * Run isolation: every run gets a new `runId`; snapshots, statuses and errors from any
 * other run are dropped, and a snapshot whose `seq` is not newer than the last one is ignored.
 *
 * Every accepted snapshot is processed, but repaints go through a `RepaintPacer`: on a device
 * that can't keep up, the dashboard repaints at most 10 times a second with the latest totals.
 */
@Service()
export class ProducerStore {
  private readonly createWorker = inject(WORKER_FACTORY);
  private readonly nextSeed = inject(SEED_SOURCE);
  private readonly wasmUrl = inject(WASM_URL);
  private readonly clock = inject(PRODUCER_CLOCK);
  private readonly meter = new ThroughputMeter();
  private readonly pacer = new RepaintPacer<DisplayState>(
    { clock: this.clock, scheduler: inject(PRODUCER_SCHEDULER), frames: inject(FRAME_SOURCE) },
    (display) => {
      this.accumulators.set(display.instruments);
      this.statsState.set(display.stats);
    },
    (throttled) => {
      this.repaintsLimitedState.set(throttled);
    },
  );

  private worker: WorkerPort | null = null;
  private lastSeq = -1;

  private readonly statusState = signal<ProducerStatus>('initializing');
  private readonly settingsState = signal<ProducerSettings>(DEFAULT_SETTINGS);
  private readonly runIdState = signal(0);
  private readonly accumulators = signal<readonly InstrumentAccumulatorDto[]>(
    createAccumulators(DEFAULT_SETTINGS.instrumentCount),
  );
  private readonly statsState = signal<ProducerStats>(EMPTY_STATS);
  private readonly errorState = signal<string | null>(null);
  private readonly repaintsLimitedState = signal(false);

  readonly status = this.statusState.asReadonly();
  readonly settings = this.settingsState.asReadonly();
  readonly runId = this.runIdState.asReadonly();
  readonly stats = this.statsState.asReadonly();
  readonly error = this.errorState.asReadonly();
  /** True while repaints are limited to 10/s because this device can't keep up. */
  readonly repaintsLimited = this.repaintsLimitedState.asReadonly();
  /** Display metrics, derived from the raw sums of the latest accepted snapshot. */
  readonly rows = computed(() => this.accumulators().map(deriveMetrics));

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.pacer.stop();
      this.disconnect(true);
    });
  }

  /** App initializer: creates the one worker and starts run 1 with the defaults. Idempotent. */
  boot(): void {
    if (this.worker !== null) return;
    this.pacer.start();
    this.connect();
  }

  /**
   * Starts a new run with `settings` (also from paused). Rows reset synchronously, so nothing
   * from the previous run is ever shown again. From `error`, the worker is recreated first.
   * @throws RangeError for invalid settings — the settings form never submits those.
   */
  apply(settings: ProducerSettings): void {
    const valid = validateSettings(settings);
    if (!valid.ok) {
      const detail = valid.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      throw new RangeError(`invalid producer settings — ${detail}`);
    }
    this.settingsState.set(valid.value);
    if (this.statusState() === 'error' || this.worker === null) this.reconnect();
    else this.startRun();
  }

  pause(): void {
    if (this.statusState() !== 'running') return;
    this.send({ type: 'pause', runId: this.runIdState() });
    // Show everything received so far: a paused table must not lag behind a deferred repaint.
    this.pacer.flush();
    this.statusState.set('paused');
    this.meter.clearWindow();
    this.statsState.update((s) => ({ ...s, updatesPerSec: 0 }));
  }

  resume(): void {
    if (this.statusState() !== 'paused') return;
    this.send({ type: 'resume', runId: this.runIdState() });
    this.statusState.set('running');
  }

  /** Only from `error`: terminates the worker, creates a new one and starts a new run. */
  retry(): void {
    if (this.statusState() === 'error') this.reconnect();
  }

  private reconnect(): void {
    this.disconnect(false);
    this.connect();
  }

  private connect(): void {
    const worker = this.createWorker();
    worker.onmessage = (event) => {
      this.onMessage(event.data);
    };
    worker.onerror = (event) => {
      this.fail(`The market producer crashed: ${event.message || 'unknown error'}`);
    };
    worker.onmessageerror = () => {
      this.fail('Could not read a message from the market producer.');
    };
    this.worker = worker;
    worker.postMessage({ type: 'init', wasmUrl: this.wasmUrl });
    this.startRun();
  }

  /**
   * Ends the current worker. `graceful` also posts `dispose`, best-effort only: `terminate()`
   * follows at once and usually wins, but it frees the worker's Wasm memory either way.
   */
  private disconnect(graceful: boolean): void {
    const worker = this.worker;
    if (worker === null) return;
    worker.onmessage = worker.onerror = worker.onmessageerror = null;
    if (graceful) worker.postMessage({ type: 'dispose' });
    worker.terminate();
    this.worker = null;
  }

  private startRun(): void {
    const runId = this.runIdState() + 1;
    const settings = this.settingsState();
    this.runIdState.set(runId);
    // A deferred repaint belongs to the old run: it must never be shown.
    this.pacer.drop();
    this.accumulators.set(createAccumulators(settings.instrumentCount));
    this.statsState.set(EMPTY_STATS);
    this.meter.reset();
    this.lastSeq = -1;
    this.errorState.set(null);
    this.statusState.set('initializing');
    this.send({ type: 'start', runId, settings, seed: this.nextSeed() });
  }

  private onMessage(message: FromWorker): void {
    switch (message.type) {
      case 'ready':
        return;
      case 'snapshot':
        this.onSnapshot(message);
        return;
      case 'status':
        if (this.isCurrent(message.runId) && this.statusState() !== 'error') {
          this.statusState.set(message.status);
        }
        return;
      case 'error':
        if (message.runId === null || this.isCurrent(message.runId)) {
          this.fail(describeError(message));
        }
        return;
    }
  }

  private onSnapshot(snapshot: Snapshot): void {
    if (!this.isCurrent(snapshot.runId) || snapshot.seq <= this.lastSeq) return;
    this.lastSeq = snapshot.seq;
    const { batches, updates } = snapshot.stats;
    // A batch generated before Pause can land after it (same run, accepted): its totals count,
    // but it must not bring the measured rate back while paused.
    if (this.statusState() === 'paused') this.meter.sync(updates);
    const updatesPerSec =
      this.statusState() === 'paused' ? 0 : this.meter.record(this.clock.now(), updates);
    this.pacer.offer({
      instruments: snapshot.instruments,
      stats: { updatesPerSec, batches, updates },
    });
  }

  private isCurrent(runId: number): boolean {
    return runId === this.runIdState();
  }

  private fail(message: string): void {
    this.statusState.set('error');
    this.errorState.set(message);
  }

  private send(message: ToWorker): void {
    this.worker?.postMessage(message);
  }
}
