/** A seeded market-update generator backed by one Wasm producer instance. */
export interface MarketGenerator {
  /**
   * Generates `n` updates and returns a view of `n × RECORD_WORDS` u32 words.
   * The view is valid only until the next `generate` or `dispose` call (memory growth detaches it).
   */
  generate(n: number): Uint32Array;
  /** Frees the Wasm producer. Idempotent; `generate` afterwards throws. */
  dispose(): void;
}

export interface GeneratorFactory {
  /** `seed` is `[lo, hi]` — the two u32 halves of the 64-bit seed. */
  create(instrumentCount: number, seed: readonly [number, number]): MarketGenerator;
}
