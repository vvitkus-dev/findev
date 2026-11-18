import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD, RECORD_WORDS } from '../src/app/core/producer/engine/record-layout';
import type { GeneratorFactory } from '../src/app/core/producer/engine/wasm-generator.model';
import {
  WasmAbiError,
  loadWasmGeneratorFactory,
} from '../src/app/core/producer/engine/wasm-generator';

const WASM = new URL('../public/wasm/producer.wasm', import.meta.url);
const MAX_BOOK_QTY = 1000;

/** Module exporting only `abi_version() -> 2`. */
const ABI_V2_MODULE = Uint8Array.from([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  0x01,
  0x05,
  0x01,
  0x60,
  0x00,
  0x01,
  0x7f,
  0x03,
  0x02,
  0x01,
  0x00,
  0x07,
  0x0f,
  0x01,
  0x0b,
  ...new TextEncoder().encode('abi_version'),
  0x00,
  0x00,
  0x0a,
  0x06,
  0x01,
  0x04,
  0x00,
  0x41,
  0x02,
  0x0b,
]);

/** Every market invariant for one record; returns the broken rules (empty when valid). */
function brokenRules(w: Uint32Array, base: number, instruments: number): string[] {
  const at = (field: number): number => w[base + field] ?? Number.NaN;
  const [price, bid, ask] = [at(FIELD.priceCents), at(FIELD.bidCents), at(FIELD.askCents)];
  const rules: [boolean, string][] = [
    [at(FIELD.instrument) < instruments, 'instrument in range'],
    [price > 0, 'price > 0'],
    [bid > 0 && bid < ask, '0 < bid < ask'],
    [price === bid || price === ask, 'trade at bid or ask'],
    [at(FIELD.tradeQty) >= 1, 'trade qty ≥ 1'],
    [at(FIELD.bidQty) <= MAX_BOOK_QTY && at(FIELD.askQty) <= MAX_BOOK_QTY, 'book qty ≤ 1000'],
  ];
  return rules.filter(([ok]) => !ok).map(([, rule]) => rule);
}

describe('producer.wasm through the TypeScript adapter', () => {
  let factory: GeneratorFactory;

  beforeAll(async () => {
    factory = await loadWasmGeneratorFactory(readFileSync(WASM));
  });

  it.each([1, 100, 1000])('generate(%d) returns n × 7 words', (n) => {
    // Arrange
    const generator = factory.create(5, [1, 0]);

    // Act
    const words = generator.generate(n);

    // Assert
    expect(words).toHaveLength(n * RECORD_WORDS);
    generator.dispose();
  });

  it('50 000 updates over 50 instruments all satisfy the market invariants', () => {
    // Arrange
    const generator = factory.create(50, [0xdead_beef, 0x1234]);
    const broken = new Map<string, number>();

    // Act
    for (let batch = 0; batch < 50; batch++) {
      const words = generator.generate(1000);
      for (let base = 0; base < words.length; base += RECORD_WORDS) {
        for (const rule of brokenRules(words, base, 50))
          broken.set(rule, (broken.get(rule) ?? 0) + 1);
      }
    }

    // Assert
    expect(Object.fromEntries(broken)).toEqual({});
    generator.dispose();
  });

  it('the same seed gives identical output across two factory instances', async () => {
    // Arrange
    const other = await loadWasmGeneratorFactory(readFileSync(WASM));
    const [a, b] = [factory.create(7, [42, 7]), other.create(7, [42, 7])];

    // Act
    const runs = [a, b].map((g) => Array.from({ length: 5 }, () => [...g.generate(200)]).flat());

    // Assert
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]).not.toEqual([...factory.create(7, [43, 7]).generate(1000)]);
  });

  it('memory growth detaches old views, so every generate returns a fresh valid view', () => {
    // Arrange — keep one view, then allocate ~4 MB of producers to force memory.grow()
    const first = factory.create(3, [5, 0]);
    const stale = first.generate(10);
    const others = Array.from({ length: 150 }, (_, i) => factory.create(50, [i, 1]));
    for (const g of others) g.generate(1000);

    // Act
    const fresh = first.generate(10);

    // Assert
    expect(stale.length).toBe(0); // detached ArrayBuffer — reading it would silently see nothing
    expect(fresh).toHaveLength(10 * RECORD_WORDS);
    expect(brokenRules(fresh, 0, 3)).toEqual([]);
    for (const g of [first, ...others]) g.dispose();
  });

  it.each([0, 51])('rejects instrumentCount %d', (count) => {
    // Act
    const create = (): unknown => factory.create(count, [0, 0]);

    // Assert
    expect(create).toThrow(RangeError);
  });

  it('rejects a module with a different ABI version', async () => {
    // Act
    const load = loadWasmGeneratorFactory(ABI_V2_MODULE);

    // Assert
    await expect(load).rejects.toThrow(WasmAbiError);
  });

  it('generate after dispose throws', () => {
    // Arrange
    const generator = factory.create(1, [0, 0]);
    generator.dispose();

    // Act
    const run = (): unknown => generator.generate(1);

    // Assert
    expect(run).toThrow(/after dispose/);
  });
});
