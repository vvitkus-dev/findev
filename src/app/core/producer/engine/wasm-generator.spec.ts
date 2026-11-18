import { RECORD_WORDS } from './record-layout';
import {
  ABI_VERSION,
  WasmAbiError,
  createGeneratorFactory,
  loadWasmGeneratorFactory,
} from './wasm-generator';

/** Hand-encoded module exporting only `abi_version() -> 2` (type, function, export, code). */
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

const PTR = 64;

/** Plain-object stand-in for the Wasm exports; records the calls it receives. */
function fakeExports(overrides: Record<string, unknown> = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const calls = { create: [] as number[][], destroy: [] as number[] };
  const exports = {
    memory,
    abi_version: () => ABI_VERSION,
    record_words: () => RECORD_WORDS,
    producer_create: (count: number, lo: number, hi: number) => {
      calls.create.push([count, lo, hi]);
      return count >= 1 && count <= 50 ? 8 : 0;
    },
    producer_generate: (producer: number, n: number) => {
      if (producer === 0 || n < 1 || n > 1000) return 0;
      new Uint32Array(memory.buffer, PTR, n * RECORD_WORDS).fill(n);
      return PTR;
    },
    producer_destroy: (producer: number) => {
      calls.destroy.push(producer);
    },
    ...overrides,
  };
  return { exports, calls };
}

describe('WasmGenerator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a view of exactly n × 7 words at the returned pointer', () => {
    // Arrange
    const { exports } = fakeExports();
    const generator = createGeneratorFactory(exports).create(3, [1, 0]);

    // Act
    const words = generator.generate(4);

    // Assert
    expect(words).toHaveLength(4 * RECORD_WORDS);
    expect(words.byteOffset).toBe(PTR);
    expect([...words].every((w) => w === 4)).toBe(true);
  });

  it('passes both seed halves as unsigned 32-bit integers', () => {
    // Arrange
    const { exports, calls } = fakeExports();

    // Act
    createGeneratorFactory(exports).create(5, [-1, 2 ** 32 + 7]);

    // Assert
    expect(calls.create).toEqual([[5, 0xffff_ffff, 7]]);
  });

  it('dispose is idempotent and generate afterwards throws', () => {
    // Arrange
    const { exports, calls } = fakeExports();
    const generator = createGeneratorFactory(exports).create(1, [0, 0]);

    // Act
    generator.dispose();
    generator.dispose();

    // Assert
    expect(calls.destroy).toEqual([8]);
    expect(() => generator.generate(1)).toThrow(/after dispose/);
  });

  it.each([0, 1001, 1.5])('generate(%d) throws RangeError', (n) => {
    // Arrange
    const generator = createGeneratorFactory(fakeExports().exports).create(1, [0, 0]);

    // Act
    const run = (): unknown => generator.generate(n);

    // Assert
    expect(run).toThrow(RangeError);
  });

  it.each([0, 51, 2.5])('create(%d) throws RangeError', (count) => {
    // Arrange
    const factory = createGeneratorFactory(fakeExports().exports);

    // Act
    const create = (): unknown => factory.create(count, [0, 0]);

    // Assert
    expect(create).toThrow(RangeError);
  });

  it.each<[string, unknown, RegExp]>([
    [
      'a different ABI version',
      fakeExports({ abi_version: () => 2 }).exports,
      /abi_version 2, expected 1/,
    ],
    ['a different record size', fakeExports({ record_words: () => 8 }).exports, /record_words 8/],
    [
      'missing functions',
      { abi_version: () => 1 },
      /missing exports: record_words, producer_create/,
    ],
    ['no memory export', fakeExports({ memory: {} }).exports, /missing exports: memory/],
    ['a non-object', null, /missing exports/],
  ])('rejects a module with %s', (_label, exports, message) => {
    // Act
    const wrap = (): unknown => createGeneratorFactory(exports);

    // Assert
    expect(wrap).toThrow(WasmAbiError);
    expect(wrap).toThrow(message);
  });

  it('loads module bytes and verifies the ABI', async () => {
    // Act
    const load = loadWasmGeneratorFactory(ABI_V2_MODULE);

    // Assert
    await expect(load).rejects.toThrow(new WasmAbiError('abi_version 2, expected 1'));
  });

  it.each(['application/wasm', 'application/octet-stream'])(
    'loads from a URL served as %s (streaming or arrayBuffer fallback)',
    async (contentType) => {
      // Arrange
      const fetchSpy = vi.fn(() =>
        Promise.resolve(new Response(ABI_V2_MODULE, { headers: { 'content-type': contentType } })),
      );
      vi.stubGlobal('fetch', fetchSpy);

      // Act
      const load = loadWasmGeneratorFactory(new URL('https://example.test/app/wasm/producer.wasm'));

      // Assert
      await expect(load).rejects.toThrow(WasmAbiError);
      expect(fetchSpy).toHaveBeenCalledOnce();
    },
  );

  it('reports an HTTP error instead of a compile error', async () => {
    // Arrange
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('missing', { status: 404 }))),
    );

    // Act
    const load = loadWasmGeneratorFactory(new URL('https://example.test/missing.wasm'));

    // Assert
    await expect(load).rejects.toThrow('HTTP 404');
  });
});
