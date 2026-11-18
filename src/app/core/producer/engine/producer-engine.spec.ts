import { SETTINGS, WASM_URL, createEngineHarness, total } from './testing/engine-harness';

describe('ProducerEngine — cadence (3.2)', () => {
  it('emits exactly 4 snapshots at t = 0, 500, 1000, 1500 after start + advance(1500)', async () => {
    // Arrange
    const h = createEngineHarness();
    const times: number[] = [];
    h.factory.onGenerate = () => times.push(h.time.now());
    await h.startRun(1);

    // Act
    h.time.advance(500 * 3);

    // Assert
    expect(h.snapshots(1).map((s) => s.seq)).toEqual([0, 1, 2, 3]);
    expect(times).toEqual([0, 500, 1_000, 1_500]);
  });

  it('asks the generator for exactly updatesPerBatch updates per batch', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1, { ...SETTINGS, updatesPerBatch: 37 });

    // Act
    h.time.advance(1_000);

    // Assert
    expect(h.factory.generateCalls).toEqual([37, 37, 37]);
    expect(h.factory.generators[0]?.instrumentCount).toBe(SETTINGS.instrumentCount);
  });

  it('accumulates totals across batches and reports run stats', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);

    // Act
    h.time.advance(500);

    // Assert
    const [first, second] = h.snapshots(1);
    expect(total(first, 'volume')).toBe(100);
    expect(total(second, 'volume')).toBe(200);
    expect(second?.stats).toEqual({ batches: 2, updates: 200, lastBatchMs: 0 });
    expect(second?.instruments.map((a) => a.symbol)).toEqual(['ALFA', 'BETA', 'GAMA']);
  });

  it('posts copies: later batches never change an already-posted snapshot', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);
    h.time.advance(0);
    const first = structuredClone(h.snapshots(1)[0]);

    // Act
    h.time.advance(1_000);

    // Assert
    expect(h.snapshots(1)[0]).toEqual(first);
  });

  it('loads the factory once from the init URL and reports ready', async () => {
    // Arrange
    const h = createEngineHarness();

    // Act
    await h.engine.handle({ type: 'init', wasmUrl: WASM_URL });
    await h.engine.handle({ type: 'init', wasmUrl: WASM_URL });

    // Assert
    expect(h.loads).toEqual([WASM_URL]);
    expect(h.of('ready')).toHaveLength(2);
  });
});

describe('ProducerEngine — pause / resume (3.3)', () => {
  it('pause stops generation entirely', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);
    h.time.advance(500);
    const callsBefore = h.factory.generateCalls.length;

    // Act
    await h.engine.handle({ type: 'pause', runId: 1 });
    h.time.advance(10_000);

    // Assert
    expect(h.factory.generateCalls.length).toBe(callsBefore);
    expect(h.of('status').map((m) => m.status)).toEqual(['running', 'paused']);
  });

  it('resume does not catch up: nothing at +499 ms, exactly one batch at +500 ms', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);
    h.time.advance(0);
    await h.engine.handle({ type: 'pause', runId: 1 });
    h.time.advance(60_000);
    const callsBefore = h.factory.generateCalls.length;

    // Act
    await h.engine.handle({ type: 'resume', runId: 1 });
    h.time.advance(499);
    const afterNearly = h.factory.generateCalls.length;
    h.time.advance(1);

    // Assert
    expect(afterNearly).toBe(callsBefore);
    expect(h.factory.generateCalls.length).toBe(callsBefore + 1);
  });

  it('keeps totals across pause: after resume volume = before + the next batch only', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);
    h.time.advance(500);
    await h.engine.handle({ type: 'pause', runId: 1 });
    const before = total(h.snapshots(1).at(-1), 'volume');

    // Act
    await h.engine.handle({ type: 'resume', runId: 1 });
    h.time.advance(500);

    // Assert
    expect(total(h.snapshots(1).at(-1), 'volume')).toBe(before + SETTINGS.updatesPerBatch);
  });

  it('pause + resume within one interval keeps a single batch chain (no doubled cadence)', async () => {
    // Arrange
    const h = createEngineHarness();
    const times: number[] = [];
    h.factory.onGenerate = () => times.push(h.time.now());
    await h.startRun(1);
    h.time.advance(100);

    // Act — pause and resume 100 ms into the interval, then run 2 s
    await h.engine.handle({ type: 'pause', runId: 1 });
    await h.engine.handle({ type: 'resume', runId: 1 });
    h.time.advance(2_000);

    // Assert — one chain: resume + 500, then every 500 ms (a leaked timer would add t = 500, 1000…)
    expect(times).toEqual([0, 600, 1_100, 1_600, 2_100]);
  });

  it('ignores a repeated pause and a resume while running', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);

    // Act
    await h.engine.handle({ type: 'resume', runId: 1 });
    await h.engine.handle({ type: 'pause', runId: 1 });
    await h.engine.handle({ type: 'pause', runId: 1 });

    // Assert
    expect(h.of('status').map((m) => m.status)).toEqual(['running', 'paused']);
  });
});

describe('ProducerEngine — run isolation and cleanup (3.4)', () => {
  it('start(run 2) disposes run 1 exactly once and cancels its timer', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);
    h.time.advance(500);
    const run1Snapshots = h.snapshots(1).length;

    // Act
    await h.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: [2, 0] });
    h.time.advance(5_000);

    // Assert
    expect(h.factory.generators[0]?.disposeCount).toBe(1);
    expect(h.snapshots(1)).toHaveLength(run1Snapshots);
    expect(h.factory.generators[1]?.seed).toEqual([2, 0]);
  });

  it('run 2 starts from seq 0 with zeroed totals', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);
    h.time.advance(2_000);

    // Act
    await h.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: [2, 0] });
    h.time.advance(0);

    // Assert
    const [first] = h.snapshots(2);
    expect(first?.seq).toBe(0);
    expect(total(first, 'volume')).toBe(SETTINGS.updatesPerBatch);
    expect(first?.stats.batches).toBe(1);
  });

  it('ignores stale pause/resume for run 1 while run 2 is active', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);
    await h.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: [2, 0] });

    // Act
    await h.engine.handle({ type: 'pause', runId: 1 });
    await h.engine.handle({ type: 'resume', runId: 1 });
    h.time.advance(1_000);

    // Assert
    expect(h.of('status').filter((m) => m.status === 'paused')).toHaveLength(0);
    expect(h.snapshots(2)).toHaveLength(3);
  });

  it('dispose frees the generator and nothing is posted afterwards', async () => {
    // Arrange
    const h = createEngineHarness();
    await h.startRun(1);
    h.time.advance(500);
    const postsBefore = h.posts.length;

    // Act
    await h.engine.handle({ type: 'dispose' });
    await h.engine.handle({ type: 'start', runId: 2, settings: SETTINGS, seed: [2, 0] });
    h.time.advance(1_000_000);

    // Assert
    expect(h.factory.generators[0]?.disposeCount).toBe(1);
    expect(h.factory.generators).toHaveLength(1);
    expect(h.posts).toHaveLength(postsBefore);
    expect(h.time.pending).toBe(0);
  });
});
