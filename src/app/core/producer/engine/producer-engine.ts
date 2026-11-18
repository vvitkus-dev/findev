import { applyBatch, createAccumulators } from './metrics';
import { validateSettings } from './producer-settings';
import type { ProducerSettings } from './producer-settings.model';
import type { FromWorker, InstrumentAccumulatorDto, ToWorker } from './protocol.model';
import type { Clock, Scheduler, TimerHandle } from './scheduler.model';
import type { GeneratorFactory, MarketGenerator } from './wasm-generator.model';

export interface ProducerEngineDeps {
  /** Loads the Wasm generator factory from the URL sent in `init`. */
  readonly loadFactory: (wasmUrl: string) => Promise<GeneratorFactory>;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly post: (message: FromWorker) => void;
}

interface Run {
  readonly id: number;
  readonly settings: ProducerSettings;
  readonly generator: MarketGenerator;
  readonly acc: InstrumentAccumulatorDto[];
  seq: number;
  batches: number;
  updates: number;
  paused: boolean;
  timer: TimerHandle | null;
}

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Worker-side producer state machine. Framework-free and time-free: all timing goes through
 * the injected `Scheduler`/`Clock`, so tests drive it with virtual time.
 *
 * - Commands run through a serial queue, so `start` waiting for `init` can't be overtaken.
 * - One run at a time; every run-scoped command for another `runId` is ignored.
 * - Batches self-reschedule with `max(0, interval − elapsed)`: no overlap, no catch-up bursts.
 */
export class ProducerEngine {
  private queue: Promise<void> = Promise.resolve();
  private factory: GeneratorFactory | null = null;
  private initError: string | null = null;
  private run: Run | null = null;
  private disposed = false;

  constructor(private readonly deps: ProducerEngineDeps) {}

  /** Enqueues a command; the returned promise settles when it has been processed. */
  handle(message: ToWorker): Promise<void> {
    this.queue = this.queue.then(() => this.process(message));
    return this.queue;
  }

  private async process(message: ToWorker): Promise<void> {
    if (this.disposed) return;
    switch (message.type) {
      case 'init':
        await this.init(message.wasmUrl);
        return;
      case 'start':
        this.start(message.runId, message.settings, message.seed);
        return;
      case 'pause':
        this.pause(message.runId);
        return;
      case 'resume':
        this.resume(message.runId);
        return;
      case 'dispose':
        this.stopRun();
        this.disposed = true;
        return;
    }
  }

  private async init(wasmUrl: string): Promise<void> {
    if (this.factory === null) {
      try {
        this.factory = await this.deps.loadFactory(wasmUrl);
        this.initError = null;
      } catch (error) {
        this.initError = `failed to load ${wasmUrl}: ${errorText(error)}`;
        this.post({ type: 'error', runId: null, phase: 'init', message: this.initError });
        return;
      }
    }
    this.post({ type: 'ready' });
  }

  private start(runId: number, settings: ProducerSettings, seed: readonly [number, number]): void {
    this.stopRun();
    if (this.factory === null) {
      const message = this.initError ?? 'start received before init';
      this.post({ type: 'error', runId, phase: 'init', message });
      return;
    }
    const valid = validateSettings(settings);
    if (!valid.ok) {
      const message = valid.errors.map((e) => `${e.field}: ${e.message}`).join('; ');
      this.post({
        type: 'error',
        runId,
        phase: 'runtime',
        message: `invalid settings — ${message}`,
      });
      return;
    }
    try {
      const generator = this.factory.create(valid.value.instrumentCount, seed);
      const acc = createAccumulators(valid.value.instrumentCount);
      this.run = {
        id: runId,
        settings: valid.value,
        generator,
        acc,
        seq: 0,
        batches: 0,
        updates: 0,
        paused: false,
        timer: null,
      };
    } catch (error) {
      this.post({ type: 'error', runId, phase: 'runtime', message: errorText(error) });
      return;
    }
    this.post({ type: 'status', runId, status: 'running' });
    this.scheduleTick(this.run, 0);
  }

  private pause(runId: number): void {
    const run = this.run;
    if (run?.id !== runId || run.paused) return;
    this.cancelTimer(run);
    run.paused = true;
    this.post({ type: 'status', runId, status: 'paused' });
  }

  private resume(runId: number): void {
    const run = this.run;
    if (run?.id !== runId || !run.paused) return;
    run.paused = false;
    this.post({ type: 'status', runId, status: 'running' });
    // A full interval from now: time spent paused is never "caught up".
    this.scheduleTick(run, run.settings.batchIntervalMs);
  }

  private scheduleTick(run: Run, delayMs: number): void {
    run.timer = this.deps.scheduler.schedule(delayMs, () => {
      run.timer = null;
      this.tick(run);
    });
  }

  private tick(run: Run): void {
    if (this.run !== run || run.paused) return;
    const { updatesPerBatch: n, batchIntervalMs } = run.settings;
    const startedAt = this.deps.clock.now();
    try {
      applyBatch(run.acc, run.generator.generate(n), n);
    } catch (error) {
      this.stopRun();
      this.post({ type: 'error', runId: run.id, phase: 'runtime', message: errorText(error) });
      return;
    }
    const lastBatchMs = this.deps.clock.now() - startedAt;
    run.batches += 1;
    run.updates += n;
    this.post({
      type: 'snapshot',
      runId: run.id,
      seq: run.seq++,
      instruments: run.acc.map((a) => ({ ...a })),
      stats: { batches: run.batches, updates: run.updates, lastBatchMs },
    });
    this.scheduleTick(run, Math.max(0, batchIntervalMs - lastBatchMs));
  }

  private stopRun(): void {
    const run = this.run;
    if (run === null) return;
    this.cancelTimer(run);
    run.generator.dispose();
    this.run = null;
  }

  private cancelTimer(run: Run): void {
    if (run.timer !== null) this.deps.scheduler.cancel(run.timer);
    run.timer = null;
  }

  private post(message: FromWorker): void {
    if (!this.disposed) this.deps.post(message);
  }
}
