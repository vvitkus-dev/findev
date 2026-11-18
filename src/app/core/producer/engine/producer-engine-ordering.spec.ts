import type { GeneratorFactory } from './wasm-generator.model';
import { SETTINGS, WASM_URL, createEngineHarness, deferred } from './testing/engine-harness';
import { FakeGeneratorFactory } from './testing/fake-generator';

describe('ProducerEngine — ordering (3.5)', () => {
  it('runs a start sent before init resolves only after ready', async () => {
    // Arrange
    const load = deferred<GeneratorFactory>();
    const h = createEngineHarness(() => load.promise);
    void h.engine.handle({ type: 'init', wasmUrl: WASM_URL });
    const started = h.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: [1, 0] });
    await Promise.resolve();
    const typesBeforeLoad = h.posts.map((m) => m.type);

    // Act
    load.resolve(new FakeGeneratorFactory());
    await started;
    h.time.advance(0);

    // Assert
    expect(typesBeforeLoad).toEqual([]);
    expect(h.posts.map((m) => m.type)).toEqual(['ready', 'status', 'snapshot']);
  });

  it('pause sent right after start (before load resolves) leaves the run paused with 0 batches', async () => {
    // Arrange
    const factory = new FakeGeneratorFactory();
    const load = deferred<GeneratorFactory>();
    const h = createEngineHarness(() => load.promise);
    void h.engine.handle({ type: 'init', wasmUrl: WASM_URL });
    void h.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: [1, 0] });
    const paused = h.engine.handle({ type: 'pause', runId: 1 });

    // Act
    load.resolve(factory);
    await paused;
    h.time.advance(10_000);

    // Assert
    expect(factory.generateCalls).toEqual([]);
    expect(h.of('status').map((m) => m.status)).toEqual(['running', 'paused']);
  });
});

describe('ProducerEngine — errors (3.5)', () => {
  it('a failed load posts exactly one init error naming the URL and the cause', async () => {
    // Arrange
    const h = createEngineHarness(() => Promise.reject(new Error('HTTP 404')));

    // Act
    await h.engine.handle({ type: 'init', wasmUrl: WASM_URL });

    // Assert
    expect(h.posts).toEqual([
      {
        type: 'error',
        runId: null,
        phase: 'init',
        message: `failed to load ${WASM_URL}: HTTP 404`,
      },
    ]);
  });

  it('start after a failed init reports the init error for that run instead of crashing', async () => {
    // Arrange
    const h = createEngineHarness(() => Promise.reject(new Error('compile error')));
    await h.engine.handle({ type: 'init', wasmUrl: WASM_URL });

    // Act
    await h.engine.handle({ type: 'start', runId: 4, settings: SETTINGS, seed: [4, 0] });

    // Assert
    const error = h.of('error').at(-1);
    expect(error).toMatchObject({ runId: 4, phase: 'init' });
    expect(error?.message).toContain('compile error');
    expect(h.of('status')).toEqual([]);
  });

  it('start before any init is rejected with an init error', async () => {
    // Arrange
    const h = createEngineHarness();

    // Act
    await h.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: [1, 0] });

    // Assert
    expect(h.posts).toEqual([
      { type: 'error', runId: 1, phase: 'init', message: 'start received before init' },
    ]);
  });

  it('a throwing generator posts a runtime error, stops the run and frees it', async () => {
    // Arrange
    const h = createEngineHarness();
    h.factory.onGenerate = (_n, call) => {
      if (call === 1) throw new Error('unreachable executed');
    };
    await h.startRun(1);

    // Act
    h.time.advance(5_000);

    // Assert
    expect(h.snapshots(1)).toHaveLength(1);
    expect(h.of('error')).toEqual([
      { type: 'error', runId: 1, phase: 'runtime', message: 'unreachable executed' },
    ]);
    expect(h.time.pending).toBe(0);
    expect(h.factory.generators[0]?.disposeCount).toBe(1);
  });

  it('rejects invalid settings without creating a generator', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.engine.handle({ type: 'init', wasmUrl: WASM_URL });

    // Act
    await h.engine.handle({
      type: 'start',
      runId: 1,
      settings: { ...SETTINGS, instrumentCount: 0 },
      seed: [1, 0],
    });

    // Assert
    const error = h.of('error').at(-1);
    expect(error).toMatchObject({ runId: 1, phase: 'runtime' });
    expect(error?.message).toContain('instrumentCount');
    expect(h.factory.generators).toEqual([]);
  });

  it('reports a failing factory.create as a runtime error', async () => {
    // Arrange
    const h = createEngineHarness();
    h.factory.create = () => {
      throw new RangeError('producer rejected instrumentCount 3');
    };
    await h.engine.handle({ type: 'init', wasmUrl: WASM_URL });

    // Act
    await h.engine.handle({ type: 'start', runId: 1, settings: SETTINGS, seed: [1, 0] });

    // Assert
    expect(h.of('error').at(-1)).toMatchObject({
      phase: 'runtime',
      message: 'producer rejected instrumentCount 3',
    });
    expect(h.of('status')).toEqual([]);
  });
});

describe('ProducerEngine — slow batches (3.6)', () => {
  it('a 700 ms batch at a 500 ms interval runs the next one immediately, never overlapping or bursting', async () => {
    // Arrange — the first two batches each take 700 ms of (virtual) time, later ones are instant
    const h = createEngineHarness();
    const starts: number[] = [];
    h.factory.onGenerate = (_n, call) => {
      starts.push(h.time.now());
      if (call < 2) h.time.elapse(700);
    };
    await h.startRun(1);

    // Act
    h.time.advance(2_400);

    // Assert
    expect(starts).toEqual([0, 700, 1_400, 1_900, 2_400]);
    expect(h.snapshots(1).map((s) => s.stats.lastBatchMs)).toEqual([700, 700, 0, 0, 0]);
  });
});
