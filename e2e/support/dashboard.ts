import type { Locator, Page } from '@playwright/test';

/** One parsed metrics row, as displayed (`null` where the table shows `—`). */
export interface DisplayedRow {
  readonly symbol: string;
  readonly last: number | null;
  readonly spread: number | null;
  readonly volume: number;
  readonly vwap: number | null;
  readonly imbalance: number | null;
}

const EMPTY = '—';

const money = (text: string): number | null =>
  text === EMPTY ? null : Number(text.replace(/[$,]/g, ''));

// The table uses a typographic minus (U+2212) for negative imbalance.
const signed = (text: string): number | null =>
  text === EMPTY ? null : Number(text.replace('−', '-'));

/** The dashboard's producer status bar (a labelled region). */
export const producerBar = (page: Page): Locator => page.getByRole('region', { name: 'Producer' });

/** The live state text inside the status bar (`Running`, `Paused`, …). */
export const producerState = (page: Page): Locator => producerBar(page).getByRole('status');

/** Body rows of the metrics table: the rows that have a symbol row header. */
export const metricRows = (page: Page): Locator =>
  page
    .getByRole('table', { name: /Live metrics/ })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader') });

/** Reads and parses every metrics row currently shown. */
export async function readRows(page: Page): Promise<DisplayedRow[]> {
  const rows = await metricRows(page).all();
  return Promise.all(
    rows.map(async (row) => {
      const symbol = await row.getByRole('rowheader').innerText();
      const [last = EMPTY, spread = EMPTY, volume = '0', vwap = EMPTY, imbalance = EMPTY] = (
        await row.getByRole('cell').allInnerTexts()
      ).map((t) => t.trim());
      return {
        symbol,
        last: money(last),
        spread: money(spread),
        volume: Number(volume.replace(/,/g, '')),
        vwap: money(vwap),
        imbalance: signed(imbalance),
      };
    }),
  );
}

/** Volume per symbol, for comparing totals before and after an action. */
export async function volumes(page: Page): Promise<Record<string, number>> {
  const rows = await readRows(page);
  return Object.fromEntries(rows.map((r) => [r.symbol, r.volume]));
}

/** Sum of all displayed volumes. */
export async function totalVolume(page: Page): Promise<number> {
  const rows = await readRows(page);
  return rows.reduce((sum, r) => sum + r.volume, 0);
}

/**
 * Pauses from the dashboard and lets an in-flight snapshot land. A batch generated before Pause
 * but delivered after it is accepted by design (same run), so totals are read only after this.
 */
export async function pauseAndSettle(page: Page): Promise<void> {
  await producerBar(page).getByRole('button', { name: 'Pause' }).click();
  await producerState(page).getByText('Paused').waitFor();
  // Documented fixed wait (plan §3.1): far longer than a postMessage hop, shorter than a batch.
  await page.waitForTimeout(200);
}
