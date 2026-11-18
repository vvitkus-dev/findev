import { ProducerEngine } from '../producer-engine';
import type { ProducerSettings } from '../producer-settings.model';
import type { FromWorker } from '../protocol.model';
import type { GeneratorFactory } from '../wasm-generator.model';
import { FakeGeneratorFactory } from './fake-generator';
import { ManualScheduler } from './manual-scheduler';

export const SETTINGS: ProducerSettings = {
  instrumentCount: 3,
  updatesPerBatch: 100,
  batchIntervalMs: 500,
};
export const WASM_URL = 'https://example.test/findev/wasm/producer.wasm';

type Snapshot = Extract<FromWorker, { type: 'snapshot' }>;

/** A promise whose settlement the test controls. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export interface EngineHarness {
  readonly engine: ProducerEngine;
  readonly time: ManualScheduler;
  readonly factory: FakeGeneratorFactory;
  readonly posts: FromWorker[];
  /** URLs passed to `loadFactory`, in call order. */
  readonly loads: string[];
  snapshots(runId?: number): Snapshot[];
  of<T extends FromWorker['type']>(type: T): Extract<FromWorker, { type: T }>[];
  startRun(runId?: number, settings?: ProducerSettings): Promise<void>;
}

/** Engine wired to virtual time, a fake generator factory and a recording `post`. */
export function createEngineHarness(
  loadFactory?: (url: string) => Promise<GeneratorFactory>,
): EngineHarness {
  const time = new ManualScheduler();
  const factory = new FakeGeneratorFactory();
  const posts: FromWorker[] = [];
  const loads: string[] = [];
  const engine = new ProducerEngine({
    loadFactory: (url) => {
      loads.push(url);
      return loadFactory ? loadFactory(url) : Promise.resolve(factory);
    },
    scheduler: time,
    clock: time,
    post: (m) => posts.push(m),
  });
  const snapshots = (runId?: number): Snapshot[] =>
    posts.filter(
      (m): m is Snapshot => m.type === 'snapshot' && (runId === undefined || m.runId === runId),
    );
  const of = <T extends FromWorker['type']>(type: T) =>
    posts.filter((m): m is Extract<FromWorker, { type: T }> => m.type === type);

  /** `init` + `start` for `runId`, both fully processed. */
  async function startRun(runId = 1, settings: ProducerSettings = SETTINGS): Promise<void> {
    await engine.handle({ type: 'init', wasmUrl: WASM_URL });
    await engine.handle({ type: 'start', runId, settings, seed: [runId, 0] });
  }

  return { engine, time, factory, posts, loads, snapshots, of, startRun };
}

/** Sum of a field over all instruments of a snapshot. */
export const total = (s: Snapshot | undefined, field: 'volume' | 'trades'): number =>
  (s?.instruments ?? []).reduce((sum, a) => sum + a[field], 0);
