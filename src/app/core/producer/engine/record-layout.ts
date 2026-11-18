/**
 * Layout of one update record in Wasm memory — mirrors `Update::words()` in
 * `wasm/producer/src/model.rs`. Bump `ABI_VERSION` on both sides when this changes.
 */
export const RECORD_WORDS = 7;

/** Word offsets inside a record. */
export const FIELD = Object.freeze({
  instrument: 0,
  priceCents: 1,
  tradeQty: 2,
  bidCents: 3,
  askCents: 4,
  bidQty: 5,
  askQty: 6,
});
