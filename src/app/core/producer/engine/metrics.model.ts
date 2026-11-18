/** Display metrics derived on the main thread; `null` means "not computable yet". */
export interface InstrumentMetrics {
  readonly symbol: string;
  readonly lastPriceCents: number | null;
  /** ask − bid, in cents. */
  readonly spreadCents: number | null;
  readonly volume: number;
  /** notional / volume, in cents, unrounded (rounding happens only in formatting). */
  readonly vwapCents: number | null;
  /** (bidQty − askQty) / (bidQty + askQty), in [−1, 1]; null when the book is empty. */
  readonly imbalance: number | null;
}
