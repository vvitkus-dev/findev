import { RECORD_WORDS } from './record-layout';
import type { GeneratorFactory, MarketGenerator } from './wasm-generator.model';

/** Must equal `ABI_VERSION` in `wasm/producer/src/abi.rs`. */
export const ABI_VERSION = 1;

/** The loaded module does not implement the ABI this code was written against. */
export class WasmAbiError extends Error {
  override readonly name = 'WasmAbiError';
}

/** The raw C ABI of the producer module (all pointers are u32 offsets into `memory`). */
interface ProducerExports {
  readonly memory: WebAssembly.Memory;
  abi_version(): number;
  record_words(): number;
  producer_create(instrumentCount: number, seedLo: number, seedHi: number): number;
  producer_generate(producer: number, n: number): number;
  producer_destroy(producer: number): void;
}

const FUNCTIONS = [
  'abi_version',
  'record_words',
  'producer_create',
  'producer_generate',
  'producer_destroy',
] as const;

function assertProducerExports(exports: unknown): asserts exports is ProducerExports {
  const e = (typeof exports === 'object' && exports !== null ? exports : {}) as Record<
    string,
    unknown
  >;
  if (typeof e['abi_version'] === 'function') {
    const version: unknown = (e['abi_version'] as () => unknown)();
    if (version !== ABI_VERSION) {
      throw new WasmAbiError(`abi_version ${String(version)}, expected ${String(ABI_VERSION)}`);
    }
  }
  const missing: string[] = FUNCTIONS.filter((name) => typeof e[name] !== 'function');
  if (!(e['memory'] instanceof WebAssembly.Memory)) missing.push('memory');
  if (missing.length > 0) throw new WasmAbiError(`missing exports: ${missing.join(', ')}`);
}

class WasmGenerator implements MarketGenerator {
  private producer: number | null;

  constructor(
    private readonly wasm: ProducerExports,
    producer: number,
  ) {
    this.producer = producer;
  }

  generate(n: number): Uint32Array {
    if (this.producer === null) throw new Error('MarketGenerator used after dispose()');
    if (!Number.isInteger(n))
      throw new RangeError(`batch size must be an integer, got ${String(n)}`);
    const ptr = this.wasm.producer_generate(this.producer, n) >>> 0;
    if (ptr === 0) throw new RangeError(`producer rejected batch size ${String(n)}`);
    // Fresh view every call: if Wasm memory grew, every earlier view's buffer is detached.
    return new Uint32Array(this.wasm.memory.buffer, ptr, n * RECORD_WORDS);
  }

  dispose(): void {
    if (this.producer === null) return;
    this.wasm.producer_destroy(this.producer);
    this.producer = null;
  }
}

/** Wraps an instantiated producer module after verifying its ABI. */
export function createGeneratorFactory(exports: unknown): GeneratorFactory {
  assertProducerExports(exports);
  if (exports.record_words() !== RECORD_WORDS) {
    throw new WasmAbiError(
      `record_words ${String(exports.record_words())}, expected ${String(RECORD_WORDS)}`,
    );
  }
  return {
    create(instrumentCount, [seedLo, seedHi]) {
      if (!Number.isInteger(instrumentCount)) {
        throw new RangeError(`instrumentCount must be an integer, got ${String(instrumentCount)}`);
      }
      const producer = exports.producer_create(instrumentCount, seedLo >>> 0, seedHi >>> 0) >>> 0;
      if (producer === 0)
        throw new RangeError(`producer rejected instrumentCount ${String(instrumentCount)}`);
      return new WasmGenerator(exports, producer);
    },
  };
}

/**
 * Loads the producer module from a URL (streaming when the server sends `application/wasm`,
 * otherwise via `arrayBuffer()`) or from bytes, then verifies its ABI.
 */
export async function loadWasmGeneratorFactory(
  source: URL | BufferSource,
): Promise<GeneratorFactory> {
  const { instance } =
    source instanceof URL
      ? await instantiateUrl(source)
      : await WebAssembly.instantiate(source, {});
  return createGeneratorFactory(instance.exports);
}

async function instantiateUrl(url: URL): Promise<WebAssembly.WebAssemblyInstantiatedSource> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url.href}: HTTP ${String(response.status)}`);
  if (response.headers.get('content-type')?.startsWith('application/wasm') === true) {
    return WebAssembly.instantiateStreaming(response, {});
  }
  // Some static hosts serve .wasm with a generic MIME type, which instantiateStreaming rejects.
  return WebAssembly.instantiate(await response.arrayBuffer(), {});
}
