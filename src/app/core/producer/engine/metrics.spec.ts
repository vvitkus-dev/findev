import type { InstrumentMetrics } from './metrics.model';
import { applyBatch, createAccumulators, deriveMetrics } from './metrics';
import type { InstrumentAccumulatorDto } from './protocol.model';
import { RECORD_WORDS } from './record-layout';

interface Book {
  bid?: number;
  ask?: number;
  bq?: number;
  aq?: number;
}

/** One record in ABI order: [instrument, price, qty, bid, ask, bidQty, askQty]. */
const rec = (instrument: number, price: number, qty: number, book: Book = {}): number[] => [
  instrument,
  price,
  qty,
  book.bid ?? price - 2,
  book.ask ?? price + 2,
  book.bq ?? 500,
  book.aq ?? 500,
];
const batch = (...records: number[][]): Uint32Array => Uint32Array.from(records.flat());

function accFor(acc: InstrumentAccumulatorDto[], index: number): InstrumentAccumulatorDto {
  const a = acc[index];
  if (a === undefined) throw new Error(`no accumulator ${String(index)}`);
  return a;
}
const metricsOf = (acc: InstrumentAccumulatorDto[], index: number): InstrumentMetrics =>
  deriveMetrics(accFor(acc, index));

describe('Metrics', () => {
  it('computes the worked example: last 10200, volume 40, VWAP 10150, spread 4, imbalance 0.2', () => {
    // Arrange
    const acc = createAccumulators(1);
    const words = batch(
      rec(0, 10_000, 10, { bid: 9_996, ask: 10_000, bq: 550, aq: 450 }),
      rec(0, 10_200, 30, { bid: 10_196, ask: 10_200, bq: 600, aq: 400 }),
    );

    // Act
    applyBatch(acc, words, 2);

    // Assert
    const m = metricsOf(acc, 0);
    expect(m).toMatchObject({
      lastPriceCents: 10_200,
      volume: 40,
      vwapCents: 10_150,
      spreadCents: 4,
    });
    expect(m.imbalance).toBeCloseTo(0.2, 12);
  });

  it('starts empty: all prices null, volume 0', () => {
    // Act
    const metrics = createAccumulators(3).map(deriveMetrics);

    // Assert
    expect(metrics.map((m) => m.symbol)).toEqual(['ALFA', 'BETA', 'GAMA']);
    for (const m of metrics) {
      expect(m).toEqual({
        symbol: m.symbol,
        lastPriceCents: null,
        spreadCents: null,
        volume: 0,
        vwapCents: null,
        imbalance: null,
      });
    }
  });

  it('reports imbalance as null when the book is empty on both sides', () => {
    // Arrange
    const acc = createAccumulators(1);

    // Act
    applyBatch(acc, batch(rec(0, 5_000, 5, { bq: 0, aq: 0 })), 1);

    // Assert
    expect(metricsOf(acc, 0).imbalance).toBeNull();
  });

  it.each([
    [1_000, 0, 1],
    [0, 1_000, -1],
    [500, 500, 0],
  ])('imbalance for bidQty %d / askQty %d is %d', (bq, aq, expected) => {
    // Arrange
    const acc = createAccumulators(1);

    // Act
    applyBatch(acc, batch(rec(0, 5_000, 5, { bq, aq })), 1);

    // Assert
    expect(metricsOf(acc, 0).imbalance).toBe(expected);
  });

  it('isolates instruments: an update for one never changes another', () => {
    // Arrange
    const acc = createAccumulators(3);
    const before = [accFor(acc, 0), accFor(acc, 2)].map((a) => ({ ...a }));

    // Act
    applyBatch(acc, batch(rec(1, 7_000, 9), rec(1, 7_010, 1)), 2);

    // Assert
    expect([accFor(acc, 0), accFor(acc, 2)]).toEqual(before);
    expect(metricsOf(acc, 1).volume).toBe(10);
  });

  it('never counts book quantities in volume', () => {
    // Arrange
    const acc = createAccumulators(1);

    // Act
    applyBatch(acc, batch(rec(0, 100, 3, { bq: 1_000, aq: 999 })), 1);

    // Assert
    expect(metricsOf(acc, 0).volume).toBe(3);
  });

  it('counts each trade exactly once: applying the same batch twice doubles the sums', () => {
    // Arrange
    const acc = createAccumulators(2);
    const words = batch(rec(0, 100, 3), rec(1, 200, 4), rec(0, 110, 5));

    // Act
    applyBatch(acc, words, 3);
    applyBatch(acc, words, 3);

    // Assert
    expect(accFor(acc, 0)).toMatchObject({ volume: 16, notionalCents: 2 * (300 + 550), trades: 4 });
    expect(accFor(acc, 1)).toMatchObject({ volume: 8, notionalCents: 1_600, trades: 2 });
  });

  it('keeps state O(instruments): 10 000 updates do not grow the accumulators', () => {
    // Arrange
    const acc = createAccumulators(5);
    const words = batch(...Array.from({ length: 1_000 }, (_, i) => rec(i % 5, 1_000 + i, 1)));

    // Act
    for (let i = 0; i < 10; i++) applyBatch(acc, words, 1_000);

    // Assert
    expect(acc).toHaveLength(5);
    expect(acc.reduce((sum, a) => sum + a.trades, 0)).toBe(10_000);
    expect(Object.keys(accFor(acc, 0))).toHaveLength(9);
  });

  it('applies only the first n records of a larger buffer', () => {
    // Arrange
    const acc = createAccumulators(1);
    const words = batch(rec(0, 100, 1), rec(0, 999, 50));

    // Act
    applyBatch(acc, words, 1);

    // Assert
    expect(metricsOf(acc, 0)).toMatchObject({ lastPriceCents: 100, volume: 1 });
  });

  it('keeps notional exact up to Number.MAX_SAFE_INTEGER', () => {
    // Arrange — 2^53 − 1 = 9_007_199_254_740_991; the last trade adds exactly 10_000 × 5
    const acc = createAccumulators(1);
    accFor(acc, 0).notionalCents = Number.MAX_SAFE_INTEGER - 50_000;

    // Act
    applyBatch(acc, batch(rec(0, 10_000, 5)), 1);

    // Assert
    expect(accFor(acc, 0).notionalCents).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(accFor(acc, 0).notionalCents)).toBe(true);
  });

  it('rejects an instrument index outside the accumulators', () => {
    // Arrange
    const acc = createAccumulators(2);

    // Act
    const apply = (): void => {
      applyBatch(acc, batch(rec(2, 100, 1)), 1);
    };

    // Assert
    expect(apply).toThrow(RangeError);
    expect(apply).toThrow('instrument 2 out of range');
  });

  it('rejects n larger than the buffer holds', () => {
    // Arrange
    const acc = createAccumulators(1);
    const words = new Uint32Array(RECORD_WORDS);

    // Act
    const apply = (): void => {
      applyBatch(acc, words, 2);
    };

    // Assert
    expect(apply).toThrow(RangeError);
    expect(apply).toThrow('batch of 2 records exceeds buffer of 7 words');
  });

  it.each([0, 51, 1.5])('rejects an instrument count of %d', (count) => {
    // Act
    const create = (): unknown => createAccumulators(count);

    // Assert
    expect(create).toThrow(RangeError);
    expect(create).toThrow('instrumentCount must be 1..50');
  });

  it('accepts the maximum of 50 instruments', () => {
    // Act
    const acc = createAccumulators(50);

    // Assert
    expect(acc).toHaveLength(50);
  });

  // deriveMetrics takes any DTO (snapshots cross a thread boundary), so one missing side of the
  // quote or the book must give null, never arithmetic on null.
  it.each([
    { bidCents: null, askCents: 10_002 },
    { bidCents: 10_000, askCents: null },
  ])('spread is null for a half-filled quote %o', (quote) => {
    // Arrange
    const acc = { ...createAccumulators(1)[0], bidQty: 600, askQty: 400, ...quote };

    // Act
    const metrics = deriveMetrics(acc as InstrumentAccumulatorDto);

    // Assert
    expect(metrics.spreadCents).toBeNull();
  });

  it.each([
    { bidQty: null, askQty: 400 },
    { bidQty: 600, askQty: null },
  ])('imbalance is null for a half-filled book %o', (book) => {
    // Arrange
    const acc = { ...createAccumulators(1)[0], bidCents: 10_000, askCents: 10_002, ...book };

    // Act
    const metrics = deriveMetrics(acc as InstrumentAccumulatorDto);

    // Assert
    expect(metrics.imbalance).toBeNull();
  });
});
