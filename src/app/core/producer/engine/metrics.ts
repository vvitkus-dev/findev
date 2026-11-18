import type { InstrumentMetrics } from './metrics.model';
import type { InstrumentAccumulatorDto } from './protocol.model';
import { FIELD, RECORD_WORDS } from './record-layout';
import { SYMBOLS } from './symbols';

/** Fresh accumulators: no prices yet (null), zero sums. */
export function createAccumulators(instrumentCount: number): InstrumentAccumulatorDto[] {
  if (
    !Number.isInteger(instrumentCount) ||
    instrumentCount < 1 ||
    instrumentCount > SYMBOLS.length
  ) {
    throw new RangeError(`instrumentCount must be 1..${String(SYMBOLS.length)}`);
  }
  return SYMBOLS.slice(0, instrumentCount).map((symbol) => ({
    symbol,
    lastPriceCents: null,
    bidCents: null,
    askCents: null,
    bidQty: null,
    askQty: null,
    volume: 0,
    notionalCents: 0,
    trades: 0,
  }));
}

/**
 * Folds `n` records from `words` into the accumulators in place: O(n), no allocation.
 * Each trade counts exactly once; the latest record sets the quote and the book.
 */
export function applyBatch(acc: InstrumentAccumulatorDto[], words: Uint32Array, n: number): void {
  if (n * RECORD_WORDS > words.length) {
    throw new RangeError(
      `batch of ${String(n)} records exceeds buffer of ${String(words.length)} words`,
    );
  }
  for (let base = 0; base < n * RECORD_WORDS; base += RECORD_WORDS) {
    const index = word(words, base + FIELD.instrument);
    const a = acc[index];
    if (a === undefined) throw new RangeError(`instrument ${String(index)} out of range`);
    const price = word(words, base + FIELD.priceCents);
    const qty = word(words, base + FIELD.tradeQty);
    a.lastPriceCents = price;
    a.volume += qty;
    a.notionalCents += price * qty;
    a.trades += 1;
    a.bidCents = word(words, base + FIELD.bidCents);
    a.askCents = word(words, base + FIELD.askCents);
    a.bidQty = word(words, base + FIELD.bidQty);
    a.askQty = word(words, base + FIELD.askQty);
  }
}

/** Spread, VWAP and imbalance from raw sums; `null` wherever a denominator or input is missing. */
export function deriveMetrics(a: InstrumentAccumulatorDto): InstrumentMetrics {
  return {
    symbol: a.symbol,
    lastPriceCents: a.lastPriceCents,
    spreadCents: a.bidCents !== null && a.askCents !== null ? a.askCents - a.bidCents : null,
    volume: a.volume,
    vwapCents: a.volume > 0 ? a.notionalCents / a.volume : null,
    imbalance: imbalance(a.bidQty, a.askQty),
  };
}

function imbalance(bidQty: number | null, askQty: number | null): number | null {
  if (bidQty === null || askQty === null) return null;
  const total = bidQty + askQty;
  return total > 0 ? (bidQty - askQty) / total : null;
}

/** Bounds are checked by the caller; `?? 0` only satisfies `noUncheckedIndexedAccess`. */
function word(words: Uint32Array, i: number): number {
  return words[i] ?? 0;
}
