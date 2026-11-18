/**
 * Raw per-instrument sums kept by the worker (O(instruments), no event history).
 * Plain data so it survives `postMessage` structured cloning. Prices are integer cents.
 */
export interface InstrumentAccumulatorDto {
  symbol: string;
  lastPriceCents: number | null;
  bidCents: number | null;
  askCents: number | null;
  bidQty: number | null;
  askQty: number | null;
  /** Σ trade qty (book quantities are never counted). */
  volume: number;
  /** Σ price × qty in cents; exact while ≤ Number.MAX_SAFE_INTEGER. */
  notionalCents: number;
  trades: number;
}
