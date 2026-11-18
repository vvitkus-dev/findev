/**
 * The only place prices and ratios are rounded for display. Pure functions (no Angular),
 * wrapped by the pure pipes in `market-format-pipes.ts`. `null` means "no data yet" → `—`.
 */
export const EMPTY = '—';
const MINUS = '−'; // typographic minus, aligns with "+" in tabular figures

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const INTEGER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Integer (or fractional, e.g. VWAP) cents → `$101.50`. */
export function formatCents(cents: number | null): string {
  return cents === null || !Number.isFinite(cents) ? EMPTY : USD.format(cents / 100);
}

/** Imbalance in [−1, 1] → `+0.20` / `−0.35` / `0.00`; display is clamped to [−1, 1]. */
export function formatImbalance(value: number | null): string {
  if (value === null || Number.isNaN(value)) return EMPTY;
  const fixed = Math.min(1, Math.max(-1, value)).toFixed(2);
  const magnitude = fixed.replace('-', '');
  if (magnitude === '0.00') return magnitude; // no sign on zero, including −0.001 → "0.00"
  return fixed.startsWith('-') ? `${MINUS}${magnitude}` : `+${magnitude}`;
}

/** Cumulative volume → grouped integer, e.g. `1,234,567`. */
export function formatVolume(volume: number | null): string {
  return volume === null || !Number.isFinite(volume) ? EMPTY : INTEGER.format(volume);
}
