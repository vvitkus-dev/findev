import { RECORD_WORDS } from '../record-layout';
import type { GeneratorFactory, MarketGenerator } from '../wasm-generator.model';

/** Called on every `generate(n)`; may advance a fake clock or throw to simulate failures. */
export type GenerateHook = (n: number, call: number) => void;

/**
 * Deterministic stand-in for the Wasm generator. Each record: instrument `i % count`,
 * price 10 000 (trade at the bid), qty 1, bid 10 000, ask 10 002, book 600 / 400.
 * Counts every create / generate / dispose so tests can assert lifecycle exactly.
 */
export class FakeGeneratorFactory implements GeneratorFactory {
  readonly generators: FakeGenerator[] = [];
  onGenerate: GenerateHook = () => undefined;

  create(instrumentCount: number, seed: readonly [number, number]): MarketGenerator {
    const generator = new FakeGenerator(instrumentCount, seed, (n, call) => {
      this.onGenerate(n, call);
    });
    this.generators.push(generator);
    return generator;
  }

  /** All `generate` batch sizes across every generator, in call order. */
  get generateCalls(): number[] {
    return this.generators.flatMap((g) => g.calls);
  }
}

export class FakeGenerator implements MarketGenerator {
  readonly calls: number[] = [];
  disposeCount = 0;

  constructor(
    readonly instrumentCount: number,
    readonly seed: readonly [number, number],
    private readonly hook: GenerateHook,
  ) {}

  generate(n: number): Uint32Array {
    // Same contract as the real adapter: using a disposed generator is a bug, so fail loudly.
    if (this.disposeCount > 0) throw new Error('FakeGenerator used after dispose()');
    this.hook(n, this.calls.length);
    this.calls.push(n);
    const words = new Uint32Array(n * RECORD_WORDS);
    for (let i = 0; i < n; i++) {
      words.set([i % this.instrumentCount, 10_000, 1, 10_000, 10_002, 600, 400], i * RECORD_WORDS);
    }
    return words;
  }

  dispose(): void {
    this.disposeCount++;
  }
}
