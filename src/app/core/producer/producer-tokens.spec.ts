import { TestBed } from '@angular/core/testing';
import { realClock, realScheduler } from './engine/scheduler';
import {
  FRAME_SOURCE,
  PRODUCER_CLOCK,
  PRODUCER_SCHEDULER,
  SEED_SOURCE,
  WASM_URL,
  WORKER_FACTORY,
} from './producer-tokens';

describe('producer tokens (defaults)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.querySelector('base')?.remove();
  });

  it('WORKER_FACTORY creates a module worker from the bundled producer.worker script', () => {
    // Arrange
    const WorkerMock = vi.fn<(url: URL, options: WorkerOptions) => void>();
    vi.stubGlobal('Worker', WorkerMock);
    const factory = TestBed.inject(WORKER_FACTORY);

    // Act
    factory();

    // Assert
    expect(WorkerMock).toHaveBeenCalledOnce();
    const [url, options] = WorkerMock.mock.calls[0] ?? [];
    // The bundler rewrites `new URL('./engine/producer.worker', import.meta.url)` to a worker chunk.
    expect(String(url)).toMatch(/\/worker-[A-Z0-9]+\.js/);
    expect(options).toEqual({ type: 'module' });
  });

  it('SEED_SOURCE returns two u32 halves from crypto.getRandomValues', () => {
    // Arrange
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const seed = TestBed.inject(SEED_SOURCE);

    // Act
    const [lo, hi] = seed();

    // Assert
    expect(spy).toHaveBeenCalledOnce();
    for (const half of [lo, hi]) {
      expect(Number.isInteger(half) && half >= 0 && half <= 0xffff_ffff).toBe(true);
    }
  });

  it('WASM_URL resolves wasm/producer.wasm against <base href> (GitHub Pages sub-path)', () => {
    // Arrange
    const base = document.createElement('base');
    base.href = 'https://example.test/findev/';
    document.head.append(base);

    // Act
    const url = TestBed.inject(WASM_URL);

    // Assert
    expect(url).toBe('https://example.test/findev/wasm/producer.wasm');
  });

  it('PRODUCER_CLOCK defaults to the real monotonic clock', () => {
    // Arrange
    TestBed.configureTestingModule({});

    // Act
    const clock = TestBed.inject(PRODUCER_CLOCK);

    // Assert
    expect(clock).toBe(realClock);
  });

  it('PRODUCER_SCHEDULER defaults to setTimeout-based timers', () => {
    // Act
    const scheduler = TestBed.inject(PRODUCER_SCHEDULER);

    // Assert
    expect(scheduler).toBe(realScheduler);
  });

  it('FRAME_SOURCE requests and cancels real animation frames', () => {
    // Arrange
    const request = vi.fn<(cb: FrameRequestCallback) => number>(() => 42);
    const cancel = vi.fn<(handle: number) => void>();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const frames = TestBed.inject(FRAME_SOURCE);
    const callback = (): void => undefined;

    // Act
    const handle = frames.request(callback);
    frames.cancel(handle);

    // Assert
    expect(request).toHaveBeenCalledWith(callback);
    expect(cancel).toHaveBeenCalledWith(42);
  });
});
